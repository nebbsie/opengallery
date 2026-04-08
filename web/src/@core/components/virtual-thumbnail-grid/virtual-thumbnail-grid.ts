import {
  CdkVirtualScrollViewport,
  ScrollingModule,
  VIRTUAL_SCROLL_STRATEGY,
  VirtualScrollStrategy,
} from '@angular/cdk/scrolling';
import { NgClass, NgFor, NgTemplateOutlet } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ContentChild,
  ElementRef,
  EventEmitter,
  NgZone,
  OnDestroy,
  Output,
  TemplateRef,
  ViewChild,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { ScrollPosition } from '@core/services/scroll-position/scroll-position';
import { Subject } from 'rxjs';

export interface TimelineMonth {
  year: number;
  month: number;
  count: number;
}

export interface TimelineData {
  months: TimelineMonth[];
  total: number;
}

export type GridRow<T> =
  | { type: 'photos'; items: T[] }
  | { type: 'year-header'; year: number }
  | { type: 'month-header'; year: number; month: number; monthName: string };

const YEAR_HEADER_HEIGHT = 52;
const MONTH_HEADER_HEIGHT = 36;

class GridVirtualScrollStrategy implements VirtualScrollStrategy {
  private readonly _scrolledIndexChange = new Subject<number>();
  readonly scrolledIndexChange = this._scrolledIndexChange.asObservable();
  private _viewport: CdkVirtualScrollViewport | null = null;
  private _heights: number[] = [];
  private _cum: number[] = [0];
  private _maxBuf = 800;

  updateConfig(heights: number[], _minBuf: number, maxBuf: number): void {
    this._heights = heights;
    this._maxBuf = maxBuf;
    this._buildCum();
    if (this._viewport) {
      this._updateTotal();
      this._updateRange();
    }
  }

  private _buildCum(): void {
    this._cum = [0];
    for (const h of this._heights) this._cum.push(this._cum[this._cum.length - 1] + h);
  }

  get totalHeight(): number {
    return this._cum[this._cum.length - 1] ?? 0;
  }

  offsetForIndex(i: number): number {
    return this._cum[Math.min(i, this._heights.length)] ?? 0;
  }

  private _indexForOffset(offset: number): number {
    let lo = 0,
      hi = this._heights.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((this._cum[mid + 1] ?? Infinity) <= offset) lo = mid + 1;
      else hi = mid;
    }
    return Math.min(lo, Math.max(0, this._heights.length - 1));
  }

  attach(viewport: CdkVirtualScrollViewport): void {
    this._viewport = viewport;
    this._updateTotal();
    this._updateRange();
  }

  detach(): void {
    this._scrolledIndexChange.complete();
    this._viewport = null;
  }

  onContentScrolled(): void {
    this._updateRange();
  }
  onDataLengthChanged(): void {
    this._updateTotal();
    this._updateRange();
  }
  onContentRendered(): void {
    /* no-op */
  }
  onRenderedOffsetChanged(): void {
    /* no-op */
  }

  scrollToIndex(index: number, behavior: ScrollBehavior): void {
    this._viewport?.scrollToOffset(this.offsetForIndex(index), behavior);
  }

  private _updateTotal(): void {
    this._viewport?.setTotalContentSize(this.totalHeight);
  }

  private _updateRange(): void {
    if (!this._viewport || !this._heights.length) return;
    const scroll = this._viewport.measureScrollOffset();
    const size = this._viewport.getViewportSize();
    if (!size) return;

    const first = this._indexForOffset(scroll);
    const last = this._indexForOffset(scroll + size);

    let start = first;
    let bufBefore = 0;
    while (start > 0 && bufBefore < this._maxBuf) {
      start--;
      bufBefore += this._heights[start];
    }

    let end = last + 1;
    let bufAfter = 0;
    while (end < this._heights.length && bufAfter < this._maxBuf) {
      bufAfter += this._heights[end];
      end++;
    }

    this._viewport.setRenderedRange({ start, end: Math.min(end, this._heights.length) });
    this._viewport.setRenderedContentOffset(this.offsetForIndex(start));
    this._scrolledIndexChange.next(first);
  }
}

@Component({
  selector: 'app-virtual-thumbnail-grid',
  standalone: true,
  imports: [ScrollingModule, NgClass, NgFor, NgTemplateOutlet],
  providers: [
    { provide: VIRTUAL_SCROLL_STRATEGY, useFactory: () => new GridVirtualScrollStrategy() },
  ],
  host: {
    class: 'block h-full',
  },
  styles: `
    :host .cdk-virtual-scroll-viewport {
      overflow-x: hidden;
      scrollbar-width: thin;
      scrollbar-color: hsl(var(--muted-foreground) / 0.3) transparent;
    }
    :host .cdk-virtual-scroll-viewport::-webkit-scrollbar {
      width: 6px;
      height: 0;
    }
    :host .cdk-virtual-scroll-viewport::-webkit-scrollbar-thumb {
      background-color: hsl(var(--muted-foreground) / 0.3);
      border-radius: 9999px;
      transition: background-color 0.15s ease;
    }
    :host .cdk-virtual-scroll-viewport::-webkit-scrollbar-thumb:hover {
      background-color: hsl(var(--muted-foreground) / 0.5);
    }
    :host .cdk-virtual-scroll-viewport::-webkit-scrollbar-track {
      background: transparent;
      margin: 4px 0;
    }
    @media (min-width: 768px) {
      :host .hide-scrollbar {
        scrollbar-width: none;
      }
      :host .hide-scrollbar::-webkit-scrollbar {
        display: none;
      }
    }
  `,
  template: `
    <div class="flex h-full w-full">
      <cdk-virtual-scroll-viewport
        class="block h-full min-w-0 flex-1"
        [class.hide-scrollbar]="showTimelineRail()"
        (scrolledIndexChange)="onScrollIndexChange($event)"
        (scroll)="onScroll()"
      >
        <div
          *cdkVirtualFor="let row of gridRows(); trackBy: trackRow"
          [style.height.px]="
            row.type === 'year-header'
              ? YEAR_HEADER_HEIGHT
              : row.type === 'month-header'
                ? MONTH_HEADER_HEIGHT
                : rowHeight()
          "
        >
          @if (row.type === 'year-header') {
            <div class="flex h-full items-center px-1">
              <span class="text-3xl font-bold tracking-tight text-white/70">{{ row.year }}</span>
            </div>
          } @else if (row.type === 'month-header') {
            <div class="flex h-full items-center px-1">
              <span class="text-sm font-semibold text-white/50"
                >{{ row.monthName }} {{ row.year }}</span
              >
            </div>
          } @else {
            <div class="mb-2 grid gap-2" [style.grid-template-columns]="gridTemplateColumns()">
              <ng-container *ngFor="let item of row.items">
                <ng-container
                  *ngTemplateOutlet="itemTpl; context: templateCtx(item)"
                ></ng-container>
              </ng-container>
            </div>
          }
        </div>
      </cdk-virtual-scroll-viewport>

      @if (showTimelineRail()) {
        <div
          #timelineEl
          class="relative hidden h-full shrink-0 overflow-visible select-none md:block"
          style="width: 48px"
          (mouseenter)="onTimelineHover(true)"
          (mouseleave)="onTimelineHover(false)"
          (mousemove)="onTimelineMouseMove($event)"
          (mousedown)="onTimelineMouseDown($event)"
        >
          <div
            class="relative h-full w-full py-6 transition-opacity duration-300 ease-out"
            [style.opacity]="timelineVisible() || timelineHovered() || isDragging() ? 1 : 0.4"
          >
            <div class="relative h-full w-full">
              <div
                class="absolute top-0 bottom-0 left-1/2 w-px -translate-x-1/2 rounded-full bg-white/15"
                aria-hidden="true"
              ></div>

              <!-- Current position indicator -->
              @if (showCurrentTimelineIndicator()) {
                <div
                  class="absolute left-1/2 z-10 -translate-x-1/2 -translate-y-1/2 transition-[top] duration-150 ease-out"
                  [style.top.%]="currentTimelinePosition()"
                >
                  <div
                    class="h-[3px] w-3.5 rounded-full bg-white shadow-[0_0_4px_rgba(255,255,255,0.4)]"
                  ></div>
                </div>
              }

              @for (marker of monthMarkers(); track marker.year + '-' + marker.month) {
                <button
                  [class]="
                    marker.year === activeTimelineMarker()?.year &&
                    marker.monthName === activeTimelineMarker()?.month
                      ? 'group absolute left-1/2 z-[2] flex -translate-x-[calc(50%+4px)] -translate-y-1/2 items-center gap-1'
                      : 'group absolute left-1/2 z-[1] flex h-5 w-5 translate-x-1 -translate-y-1/2 items-center justify-center'
                  "
                  [style.top.%]="marker.position"
                  [attr.aria-label]="marker.monthName + ' ' + marker.year"
                  (click)="jumpToTimelineMonth(marker); $event.stopPropagation()"
                >
                  @if (
                    marker.year === activeTimelineMarker()?.year &&
                    marker.monthName === activeTimelineMarker()?.month
                  ) {
                    <span
                      class="text-[10px] leading-none font-semibold whitespace-nowrap text-white/90"
                      >{{ marker.monthName }}</span
                    >
                    <span
                      class="block h-2 w-2 rounded-full bg-white/90 shadow-[0_0_0_2px_rgba(255,255,255,0.18)]"
                    ></span>
                  } @else {
                    <span
                      class="block rounded-full bg-white/35 transition-all duration-150 ease-out group-hover:bg-white/80"
                      [style.width.px]="marker.dotSize"
                      [style.height.px]="marker.dotSize"
                    ></span>
                    <span
                      class="pointer-events-none absolute left-full ml-1 rounded bg-zinc-900/90 px-2 py-1 text-[10px] leading-none font-medium whitespace-nowrap text-white opacity-0 shadow-lg ring-1 ring-white/10 backdrop-blur-sm transition-opacity duration-150 group-hover:opacity-100"
                      >{{ marker.monthName }} {{ marker.year }}</span
                    >
                  }
                </button>
              }

              @for (marker of yearMarkers(); track marker.year) {
                <button
                  type="button"
                  class="group absolute left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full px-2 py-0.5 text-[11px] font-bold whitespace-nowrap transition-all duration-200 ease-out"
                  [style.top.%]="marker.position"
                  [ngClass]="
                    marker.year === activeTimelineMarker()?.year
                      ? 'bg-white/22 text-white shadow-sm ring-1 ring-white/25'
                      : 'text-white/65 hover:bg-white/10 hover:text-white'
                  "
                  (click)="jumpToTimelineMonth(marker); $event.stopPropagation()"
                >
                  {{ marker.year }}
                </button>
              }

              <!-- Hover / drag tooltip -->
              @if ((timelineHovered() || isDragging()) && hoverTimelineLabel()) {
                <div
                  class="pointer-events-none absolute right-full mr-2 -translate-y-1/2 rounded-lg bg-zinc-900/90 px-3 py-1.5 text-left whitespace-nowrap shadow-xl ring-1 ring-white/10 backdrop-blur-xl"
                  [style.top.%]="hoverTimelinePosition() ?? currentTimelinePosition()"
                >
                  <div class="text-xs leading-none font-semibold text-white">
                    {{ hoverTimelineLabel() }}
                  </div>
                </div>
              }
            </div>
          </div>
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VirtualThumbnailGrid<T = unknown> implements AfterViewInit, OnDestroy {
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly scrollPosition = inject(ScrollPosition);
  private readonly ngZone = inject(NgZone);
  private scrollRestoreState: 'pending' | 'restoring' | 'done' = 'pending';
  private targetScrollPosition: number | null = null;
  private restoreAttempts = 0;
  private readonly MAX_RESTORE_ATTEMPTS = 10;
  private readonly MONTH_NAMES = [
    '',
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];

  items = input<readonly T[] | null>([]);
  minTilePx = input(100);
  hasMore = input(false);
  isLoadingMore = input(false);
  scrollKey = input<string | null>(null);
  pageCount = input(0);
  dateAccessor = input<(item: T) => Date | string | null | undefined>(() => null);
  timelineData = input<TimelineData | null>(null);
  rowHeightExtra = input(0); // Extra height for content below thumbnail (e.g., album name)

  @Output() loadMore = new EventEmitter<void>();
  @Output() seekTo = new EventEmitter<{ year: number; month: number }>();

  @ContentChild(TemplateRef) itemTpl!: TemplateRef<{ $implicit: T }>;
  @ViewChild(CdkVirtualScrollViewport) viewport!: CdkVirtualScrollViewport;
  @ViewChild('timelineEl') timelineEl!: ElementRef<HTMLElement>;

  private readonly scrollStrategy = inject(VIRTUAL_SCROLL_STRATEGY) as GridVirtualScrollStrategy;
  protected readonly YEAR_HEADER_HEIGHT = YEAR_HEADER_HEIGHT;
  protected readonly MONTH_HEADER_HEIGHT = MONTH_HEADER_HEIGHT;

  private readonly _rowHeights = computed(() => {
    const rowH = this.rowHeight();
    return this.gridRows().map((r) =>
      r.type === 'photos'
        ? rowH
        : r.type === 'year-header'
          ? YEAR_HEADER_HEIGHT
          : MONTH_HEADER_HEIGHT,
    );
  });

  private readonly _rowCumulative = computed(() => {
    const cum = [0];
    for (const h of this._rowHeights()) cum.push(cum[cum.length - 1] + h);
    return cum;
  });

  private readonly width = signal(0);
  protected readonly timelineVisible = signal(false);
  protected readonly timelineHovered = signal(false);
  protected readonly isDragging = signal(false);
  protected readonly activeRowIndex = signal(0);
  private readonly atScrollBottom = signal(false);
  protected readonly hoverTimelinePosition = signal<number | null>(null);
  protected readonly hoverTimelineLabel = signal<string | null>(null);
  private resizeObs: ResizeObserver | null = null;
  private timelineHideTimeout: ReturnType<typeof setTimeout> | null = null;
  private seekTargetYearMonth: { year: number; month: number } | null = null;
  private boundDragMove: ((e: MouseEvent) => void) | null = null;
  private boundDragEnd: (() => void) | null = null;

  constructor() {
    // Keep custom scroll strategy in sync with row heights
    effect(() => {
      const heights = this._rowHeights();
      const rowH = this.rowHeight();
      this.scrollStrategy.updateConfig(heights, rowH * 3, rowH * 6);
    });

    // Effect to handle scroll restoration when items load
    effect(() => {
      const rows = this.rows();
      const key = this.scrollKey();

      if (this.viewport && rows.length > 0) {
        this.viewport.checkViewportSize();

        // Only attempt restoration if we haven't started yet
        if (this.scrollRestoreState === 'pending' && key) {
          this.initScrollRestoration(key);
        }

        // Check if we need to load more to fill the viewport
        this.checkIfNeedsMoreContent();

        // If seeking to a far-away row, check if we've loaded enough
        this.checkSeekTarget();
      }
    });
  }

  private checkIfNeedsMoreContent(): void {
    if (!this.hasMore() || this.isLoadingMore() || !this.viewport) return;

    requestAnimationFrame(() => {
      if (!this.viewport) return;
      const viewportHeight = this.viewport.getViewportSize();
      const contentHeight =
        this.scrollStrategy.totalHeight || this.gridRows().length * this.rowHeight();
      if (contentHeight < viewportHeight * 1.2) {
        this.loadMore.emit();
      }
    });
  }

  columns = computed(() => {
    const w = this.width();
    const min = w < 640 ? 100 : w < 1024 ? 160 : 200;
    const cols = Math.max(1, Math.floor(w / min));
    return cols;
  });

  gridTemplateColumns = computed(() => `repeat(${this.columns()}, 1fr)`);

  // Assume square tiles; include gap (approx 8px) for row height
  rowHeight = computed(() => {
    const w = this.width();
    const cols = this.columns();
    const gap = 8; // tailwind gap-2
    const tile = Math.floor((w - (cols - 1) * gap) / cols);
    return Math.max(120, tile) + gap + this.rowHeightExtra(); // include gap to avoid overlap
  });

  readonly gridRows = computed((): GridRow<T>[] => {
    const items = (this.items() ?? []) as readonly T[];
    const cols = this.columns();
    const da = this.dateAccessor();
    if (!items.length) return [];
    const out: GridRow<T>[] = [];
    let lastYear = -1;
    let lastMonth = -1;
    let chunk: T[] = [];
    const flush = () => {
      for (let i = 0; i < chunk.length; i += cols)
        out.push({ type: 'photos', items: chunk.slice(i, i + cols) });
      chunk = [];
    };
    for (const item of items) {
      const d = this.parseTimelineDate(da(item));
      const y = d?.getFullYear() ?? 0;
      const m = d ? d.getMonth() + 1 : 0;
      if (y !== lastYear) {
        flush();
        if (y) out.push({ type: 'year-header', year: y });
        if (y && m)
          out.push({
            type: 'month-header',
            year: y,
            month: m,
            monthName: this.MONTH_NAMES[m] || '',
          });
        lastYear = y;
        lastMonth = m;
      } else if (m !== lastMonth) {
        flush();
        if (m)
          out.push({
            type: 'month-header',
            year: y,
            month: m,
            monthName: this.MONTH_NAMES[m] || '',
          });
        lastMonth = m;
      }
      chunk.push(item);
    }
    flush();
    return out;
  });

  private readonly photoRows = computed(() =>
    this.gridRows().filter((r): r is { type: 'photos'; items: T[] } => r.type === 'photos'),
  );

  private readonly photoOffsetAtGridRow = computed(() => {
    let count = 0;
    return this.gridRows().map((r) => {
      const off = count;
      if (r.type === 'photos') count += r.items.length;
      return off;
    });
  });

  private gridRowForPhotoOffset(photoOffset: number): number {
    const rows = this.gridRows();
    const offsets = this.photoOffsetAtGridRow();
    let best = 0;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].type === 'photos' && offsets[i] <= photoOffset) best = i;
      else if (offsets[i] > photoOffset) break;
    }
    // Walk back past any adjacent year/month headers so we scroll to the section start
    while (best > 0 && rows[best - 1].type !== 'photos') best--;
    return best;
  }

  rows = computed(() => this.photoRows());

  /** Compute cumulative offsets for each month from server data */
  private readonly timelineMonthsWithOffset = computed(() => {
    const data = this.timelineData();
    if (!data?.months?.length) return [];
    let cumulative = 0;
    return data.months.map((m) => {
      const offset = cumulative;
      cumulative += m.count;
      return { ...m, offset, monthName: this.MONTH_NAMES[m.month] || '' };
    });
  });

  /**
   * Log-scale timeline mapping shared by markers and scroll indicator.
   * Uses log(1+count) per month to compress dominant months, then enforces
   * a minimum gap between year boundaries so years never look packed.
   * Returns separate yearPositions (for year labels) and monthPositions
   * (for month dots + scroll indicator, with first-of-year nudged below year label).
   */
  private readonly timelineLogScale = computed(() => {
    const months = this.timelineMonthsWithOffset();
    const data = this.timelineData();
    if (!months.length || !data?.total)
      return { months, monthPositions: [] as number[], yearPositions: [] as number[], total: 0 };

    // Log-weighted cumulative values per month
    const logWeights = months.map((m) => Math.log1p(m.count));
    const logCum: number[] = [];
    let cumLog = 0;
    for (const w of logWeights) {
      logCum.push(cumLog);
      cumLog += w;
    }
    const totalLog = cumLog || 1;

    // Raw log-scale positions (0-100)
    let positions = logCum.map((c) => (c / totalLog) * 100);

    // Enforce minimum gap between year boundaries
    const MIN_YEAR_GAP = 5; // minimum % between year labels
    const yearStartIndices: number[] = [];
    let lastYear = -1;
    for (let i = 0; i < months.length; i++) {
      if (months[i].year !== lastYear) {
        yearStartIndices.push(i);
        lastYear = months[i].year;
      }
    }

    // If years are too close, push them apart
    if (yearStartIndices.length > 1) {
      const adjusted = [...positions];
      for (let yi = 1; yi < yearStartIndices.length; yi++) {
        const currIdx = yearStartIndices[yi];
        const prevIdx = yearStartIndices[yi - 1];
        const gap = adjusted[currIdx] - adjusted[prevIdx];
        if (gap < MIN_YEAR_GAP) {
          const shift = MIN_YEAR_GAP - gap;
          for (let i = currIdx; i < adjusted.length; i++) {
            adjusted[i] += shift;
          }
        }
      }
      // Re-normalize to 0-100
      const maxPos =
        adjusted[adjusted.length - 1] + (logWeights[logWeights.length - 1] / totalLog) * 100;
      const scale = maxPos > 0 ? 100 / maxPos : 1;
      positions = adjusted.map((p) => p * scale);
    }

    // Year positions = raw positions at year boundaries
    const yearPositions = [...positions];

    // Month positions = nudge first-month-of-each-year just below the year label
    const monthPositions = [...positions];
    const FIRST_MONTH_NUDGE = 2.0; // % nudge below year label
    const firstMonthSet = new Set(yearStartIndices);
    for (const idx of firstMonthSet) {
      const end = idx + 1 < monthPositions.length ? monthPositions[idx + 1] : 100;
      const available = end - monthPositions[idx];
      monthPositions[idx] += Math.min(FIRST_MONTH_NUDGE, available * 0.3);
    }

    return { months, monthPositions, yearPositions, total: data.total };
  });

  /** Convert a timeline percentage back to the month it falls in */
  private timelinePercentToMonth(
    percent: number,
  ): (typeof this.timelineMonthsWithOffset extends () => (infer R)[] ? R : never) | null {
    const { months, monthPositions } = this.timelineLogScale();
    if (!months.length) return null;
    const pct = percent * 100;
    let best = 0;
    for (let i = 0; i < monthPositions.length; i++) {
      if (monthPositions[i] <= pct) best = i;
      else break;
    }
    return months[best];
  }

  /** Convert a linear photo offset to a log-scale timeline percentage.
   *  Uses monthPositions so the indicator aligns with month dots. */
  private photoOffsetToTimelinePercent(photoOffset: number): number {
    const { months, monthPositions, total } = this.timelineLogScale();
    if (!months.length || !total) return 0;

    // Find which month this offset falls in
    let monthIdx = 0;
    for (let i = 0; i < months.length; i++) {
      if (months[i].offset <= photoOffset) monthIdx = i;
      else break;
    }

    const monthStart = monthPositions[monthIdx];
    const monthEnd = monthIdx + 1 < monthPositions.length ? monthPositions[monthIdx + 1] : 100;
    const monthCount = months[monthIdx].count || 1;
    const withinMonth = Math.min(1, (photoOffset - months[monthIdx].offset) / monthCount);
    return Math.min(100, Math.max(0, monthStart + withinMonth * (monthEnd - monthStart)));
  }

  protected readonly yearMarkers = computed(() => {
    const { months, yearPositions, total } = this.timelineLogScale();
    if (!months.length || !total) return [] as { year: number; position: number; offset: number }[];

    const markers: { year: number; position: number; offset: number }[] = [];
    let lastYear = -1;
    for (let i = 0; i < months.length; i++) {
      if (months[i].year === lastYear) continue;
      lastYear = months[i].year;
      markers.push({ year: months[i].year, position: yearPositions[i], offset: months[i].offset });
    }
    return markers;
  });

  protected readonly monthMarkers = computed(() => {
    const { months, monthPositions, total } = this.timelineLogScale();
    if (!months.length || !total)
      return [] as {
        year: number;
        month: number;
        monthName: string;
        position: number;
        offset: number;
        dotSize: number;
      }[];

    const globalMaxCount = Math.max(...months.map((m) => m.count), 1);
    const sqrtMax = Math.sqrt(globalMaxCount);

    return months.map((month, i) => {
      const dotSize = Math.round(3 + (Math.sqrt(Math.max(1, month.count)) / sqrtMax) * 3);
      return {
        year: month.year,
        month: month.month,
        monthName: month.monthName,
        offset: month.offset,
        position: monthPositions[i],
        dotSize,
      };
    });
  });

  /** Map the current scroll position to a percentage on the timeline.
   *  Reads the actual date from the visible row to find the correct month
   *  in server timeline data, then interpolates within that month based on
   *  how far through it the user has scrolled.
   *  This avoids mismatch between loaded-item offsets and server-data offsets. */
  protected readonly currentTimelinePosition = computed(() => {
    const data = this.timelineData();
    if (!data?.total) return 0;

    // If at scroll bottom, always show 100%
    if (this.atScrollBottom()) return 100;

    const months = this.timelineMonthsWithOffset();
    if (!months.length) return 0;

    const allRows = this.gridRows();
    let rowIdx = this.activeRowIndex();

    // Walk to nearest photo row
    while (rowIdx < allRows.length && allRows[rowIdx].type !== 'photos') rowIdx++;
    const gridRow = allRows[rowIdx];
    if (!gridRow || gridRow.type !== 'photos') return 0;

    // Read date from the first item of the visible row
    const source = gridRow.items[0];
    const date = source ? this.parseTimelineDate(this.dateAccessor()(source)) : null;
    if (!date) return 0;

    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    const serverMonth = months.find((entry) => entry.year === y && entry.month === m);
    if (!serverMonth) return 0;

    // Count photos between the month-header and the current row
    // Walk backwards to find this month's header, then sum photo items forward
    let monthHeaderIdx = rowIdx;
    while (monthHeaderIdx > 0) {
      const prev = allRows[monthHeaderIdx - 1];
      if (prev.type === 'month-header' || prev.type === 'year-header') break;
      monthHeaderIdx--;
    }
    let photosBeforeInMonth = 0;
    for (let i = monthHeaderIdx; i < rowIdx; i++) {
      const r = allRows[i];
      if (r.type === 'photos') photosBeforeInMonth += r.items.length;
    }

    const monthProgress =
      serverMonth.count > 0 ? Math.min(1, photosBeforeInMonth / serverMonth.count) : 0;

    return this.photoOffsetToTimelinePercent(
      serverMonth.offset + monthProgress * serverMonth.count,
    );
  });

  protected readonly activeTimelineMarker = computed(() => {
    const months = this.timelineMonthsWithOffset();
    if (!months.length) return null;

    // If the active row is a header, scan forward to find the nearest photo row
    const allRows = this.gridRows();
    let rowIdx = this.activeRowIndex();
    while (rowIdx < allRows.length && allRows[rowIdx].type !== 'photos') rowIdx++;
    const gridRow = allRows[rowIdx];
    const row = gridRow?.type === 'photos' ? gridRow.items : null;
    const source = row?.[0] ?? null;
    const date = source ? this.parseTimelineDate(this.dateAccessor()(source)) : null;

    if (date) {
      const y = date.getFullYear();
      const m = date.getMonth() + 1;
      const found = months.find((entry) => entry.year === y && entry.month === m);
      if (found) return { year: found.year, month: found.monthName };
    }

    // Fallback: use first loaded month
    return months[0] ? { year: months[0].year, month: months[0].monthName } : null;
  });

  protected readonly showCurrentTimelineIndicator = computed(() => {
    const activeMarker = this.activeTimelineMarker();
    if (!activeMarker) return true;

    const activeYearMarker = this.yearMarkers().find((marker) => marker.year === activeMarker.year);
    if (!activeYearMarker) return true;

    return Math.abs(activeYearMarker.position - this.currentTimelinePosition()) > 1;
  });

  protected readonly showTimelineRail = computed(() => {
    const data = this.timelineData();
    return !!data && data.months.length >= 2;
  });

  trackRow = (index: number, row: GridRow<T>): string => {
    if (row.type === 'year-header') return `year-${row.year}`;
    if (row.type === 'month-header') return `month-${row.year}-${row.month}`;
    if (!row.items.length) return `empty-${index}`;
    const firstItem = row.items[0] as { id?: string };
    return firstItem?.id ?? `row-${index}`;
  };

  templateCtx(item: T): { $implicit: T } {
    return { $implicit: item } as { $implicit: T };
  }

  protected onTimelineHover(isHovered: boolean): void {
    this.timelineHovered.set(isHovered);
    if (isHovered) {
      this.showTimelineTemporarily();
    } else {
      this.hoverTimelineLabel.set(null);
      this.hoverTimelinePosition.set(null);
      if (!this.timelineVisible()) {
        this.clearTimelineHideTimeout();
      }
    }
  }

  protected onTimelineMouseMove(event: MouseEvent): void {
    if (this.isDragging()) return; // Drag handler takes over
    const el = this.timelineEl?.nativeElement;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const paddingY = 24;
    const trackTop = rect.top + paddingY;
    const trackHeight = rect.height - paddingY * 2;
    if (trackHeight <= 0) return;

    const percent = Math.min(1, Math.max(0, (event.clientY - trackTop) / trackHeight));
    const targetMonth = this.timelinePercentToMonth(percent);
    if (!targetMonth) return;

    this.hoverTimelinePosition.set(percent * 100);
    this.hoverTimelineLabel.set(`${targetMonth.monthName} ${targetMonth.year}`);
  }

  protected jumpToRow(rowIndex: number): void {
    if (!this.viewport) return;
    this.showTimelineTemporarily();
    this.viewport.scrollToIndex(rowIndex, 'instant');
  }

  protected onTimelineMouseDown(event: MouseEvent): void {
    event.preventDefault();
    this.isDragging.set(true);
    this.handleTimelineInteraction(event);

    this.boundDragMove = (e: MouseEvent) => {
      e.preventDefault();
      this.handleTimelineInteraction(e);
    };
    this.boundDragEnd = () => {
      this.isDragging.set(false);
      if (this.boundDragMove) document.removeEventListener('mousemove', this.boundDragMove);
      if (this.boundDragEnd) document.removeEventListener('mouseup', this.boundDragEnd);
      this.boundDragMove = null;
      this.boundDragEnd = null;
    };

    document.addEventListener('mousemove', this.boundDragMove);
    document.addEventListener('mouseup', this.boundDragEnd);
  }

  private handleTimelineInteraction(event: MouseEvent): void {
    const el = this.timelineEl?.nativeElement;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const paddingY = 24; // py-6 = 24px
    const trackTop = rect.top + paddingY;
    const trackHeight = rect.height - paddingY * 2;
    if (trackHeight <= 0) return;

    const percent = Math.min(1, Math.max(0, (event.clientY - trackTop) / trackHeight));
    const targetMonth = this.timelinePercentToMonth(percent);
    if (!targetMonth) return;

    // Update hover tooltip
    this.hoverTimelinePosition.set(percent * 100);
    this.hoverTimelineLabel.set(`${targetMonth.monthName} ${targetMonth.year}`);
    this.showTimelineTemporarily();

    // Jump to this month
    this.jumpToTimelineMonth(targetMonth);
  }

  protected jumpToTimelineMonth(marker: {
    offset: number;
    year?: number;
    month?: number;
    monthName?: string;
  }): void {
    if (!marker.year) return;

    // Resolve the target month (year-only clicks → first month of that year)
    let targetYear = marker.year;
    let targetMonth = marker.month;
    if (!targetMonth) {
      const months = this.timelineMonthsWithOffset();
      const firstMonth = months.find((m) => m.year === marker.year);
      if (firstMonth) {
        targetYear = firstMonth.year;
        targetMonth = firstMonth.month;
      } else {
        return;
      }
    }

    // Try to find the target in already-loaded grid rows
    const allRows = this.gridRows();
    for (let i = 0; i < allRows.length; i++) {
      const r = allRows[i];
      if (r.type === 'month-header' && r.year === targetYear && r.month === targetMonth) {
        this.seekTargetYearMonth = null;
        // Walk back to the year-header if it's directly above
        let scrollIdx = i;
        if (scrollIdx > 0 && allRows[scrollIdx - 1].type === 'year-header') {
          scrollIdx--;
        }
        if (this.viewport) {
          this.viewport.scrollToIndex(scrollIdx, 'instant');
        }
        return;
      }
    }

    // Not loaded — emit seekTo so the parent can reset the query to this date
    this.seekTargetYearMonth = { year: targetYear, month: targetMonth };
    // Prevent scroll restoration from fighting with the seek scroll
    this.scrollRestoreState = 'done';
    this.targetScrollPosition = null;
    const key = this.scrollKey();
    if (key) this.scrollPosition.save(key, 0);
    this.seekTo.emit({ year: targetYear, month: targetMonth });
  }

  ngAfterViewInit(): void {
    const viewportEl = this.viewport?.elementRef?.nativeElement ?? this.host.nativeElement;

    const applyWidth = (w: number) => {
      if (w > 0 && w !== this.width()) {
        this.ngZone.run(() => this.width.set(w));
      }
    };

    // ResizeObserver is the primary width source — fires immediately on observe()
    this.resizeObs = new ResizeObserver((entries: ResizeObserverEntry[]) => {
      const entry = entries[0];
      const w = entry?.contentRect?.width ?? viewportEl.clientWidth;
      applyWidth(w);
      if (this.viewport) this.viewport.checkViewportSize();
    });
    this.resizeObs.observe(viewportEl);

    // Fallback chain for first-load when ResizeObserver hasn't fired yet
    const readWidth = () =>
      applyWidth(
        viewportEl.getBoundingClientRect().width ||
          viewportEl.clientWidth ||
          viewportEl.offsetWidth,
      );
    readWidth();
    requestAnimationFrame(() => readWidth());
    // Second fallback after a tick — catches SSR hydration edge case
    setTimeout(() => readWidth(), 0);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onScrollIndexChange(_index: number): void {
    // Handled by onScroll for better control
  }

  onScroll(): void {
    // Don't save scroll position while restoring
    const key = this.scrollKey();
    if (key && this.viewport && this.scrollRestoreState === 'done') {
      this.scrollPosition.save(key, this.viewport.measureScrollOffset('top'), this.pageCount());
    }

    if (this.viewport) {
      const scrollTop = this.viewport.measureScrollOffset('top');
      const bottom = this.viewport.measureScrollOffset('bottom');
      this.atScrollBottom.set(bottom < 2);
      const cum = this._rowCumulative();
      const currentRow = cum.findIndex(
        (c, i) => c <= scrollTop && (cum[i + 1] ?? Infinity) > scrollTop,
      );
      this.activeRowIndex.set(
        Math.max(0, Math.min(Math.max(currentRow, 0), Math.max(this.gridRows().length - 1, 0))),
      );
      this.showTimelineTemporarily();
    }

    // Don't load if already loading or no more items
    if (!this.hasMore() || this.isLoadingMore() || !this.viewport) return;

    // Measure scroll progress
    const scrollTop = this.viewport.measureScrollOffset('top');
    const totalHeight =
      this.viewport.measureScrollOffset('top') + this.viewport.measureScrollOffset('bottom');

    // Trigger when scrolled past 50% of content
    const scrollProgress = totalHeight > 0 ? scrollTop / totalHeight : 0;

    if (scrollProgress > 0.5) {
      this.loadMore.emit();
    }
  }

  /** Called from the effect watching rows — if we're seeking, check if target month is now loaded */
  private checkSeekTarget(): void {
    if (!this.seekTargetYearMonth) return;
    const { year, month } = this.seekTargetYearMonth;
    const allRows = this.gridRows();

    for (let i = 0; i < allRows.length; i++) {
      const r = allRows[i];
      if (
        (r.type === 'month-header' && r.year === year && r.month === month) ||
        (r.type === 'year-header' && r.year === year)
      ) {
        this.seekTargetYearMonth = null;
        // Walk back to year-header if it's directly above so the year shows at top
        let scrollIdx = i;
        if (scrollIdx > 0 && allRows[scrollIdx - 1].type === 'year-header') {
          scrollIdx--;
        }
        if (this.viewport) {
          const idx = scrollIdx;
          setTimeout(() => this.viewport?.scrollToIndex(idx, 'instant'), 50);
        }
        return;
      }
    }
  }

  private showTimelineTemporarily(): void {
    if (!this.showTimelineRail()) return;
    this.timelineVisible.set(true);
    this.clearTimelineHideTimeout();
    this.timelineHideTimeout = setTimeout(() => {
      if (!this.timelineHovered()) {
        this.timelineVisible.set(false);
      }
    }, 900);
  }

  private clearTimelineHideTimeout(): void {
    if (this.timelineHideTimeout) {
      clearTimeout(this.timelineHideTimeout);
      this.timelineHideTimeout = null;
    }
  }

  private parseTimelineDate(value: Date | string | null | undefined): Date | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private initScrollRestoration(key: string): void {
    const savedPosition = this.scrollPosition.get(key);

    if (savedPosition === null || savedPosition <= 0) {
      this.scrollRestoreState = 'done';
      return;
    }

    this.targetScrollPosition = savedPosition;
    this.scrollRestoreState = 'restoring';
    this.restoreAttempts = 0;
    this.attemptScrollRestore();
  }

  private attemptScrollRestore(): void {
    if (
      this.scrollRestoreState !== 'restoring' ||
      !this.viewport ||
      this.targetScrollPosition === null
    ) {
      return;
    }

    this.restoreAttempts++;

    // Run outside Angular zone to avoid triggering change detection during restoration
    this.ngZone.runOutsideAngular(() => {
      // Use double RAF to ensure layout is complete
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!this.viewport || this.targetScrollPosition === null) {
            this.scrollRestoreState = 'done';
            return;
          }

          // Check if we have enough content to scroll to target position
          const totalScrollable =
            this.viewport.measureScrollOffset('top') + this.viewport.measureScrollOffset('bottom');

          // Scroll to target position instantly (no animation)
          this.viewport.scrollToOffset(this.targetScrollPosition, 'instant');

          // Verify scroll position after a short delay
          setTimeout(() => {
            if (!this.viewport || this.targetScrollPosition === null) {
              this.scrollRestoreState = 'done';
              return;
            }

            const currentPosition = this.viewport.measureScrollOffset('top');
            const tolerance = 5; // Allow 5px tolerance

            // Check if we're close enough to target or if we've reached max attempts
            if (
              Math.abs(currentPosition - this.targetScrollPosition) <= tolerance ||
              this.restoreAttempts >= this.MAX_RESTORE_ATTEMPTS
            ) {
              this.ngZone.run(() => {
                this.scrollRestoreState = 'done';
                // Save the final position
                const key = this.scrollKey();
                if (key) {
                  this.scrollPosition.save(key, currentPosition);
                }
              });
            } else if (totalScrollable < this.targetScrollPosition && this.hasMore()) {
              // Not enough content yet, wait for more to load
              // The effect will re-trigger when more items arrive
              this.scrollRestoreState = 'pending';
            } else {
              // Try again
              this.attemptScrollRestore();
            }
          }, 50);
        });
      });
    });
  }

  ngOnDestroy(): void {
    this.resizeObs?.disconnect();
    this.clearTimelineHideTimeout();
    if (this.boundDragMove) document.removeEventListener('mousemove', this.boundDragMove);
    if (this.boundDragEnd) document.removeEventListener('mouseup', this.boundDragEnd);
  }
}
