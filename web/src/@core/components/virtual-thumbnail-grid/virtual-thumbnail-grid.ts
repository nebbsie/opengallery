import {
  CdkVirtualScrollViewport,
  ScrollingModule,
  VIRTUAL_SCROLL_STRATEGY,
  VirtualScrollStrategy,
} from '@angular/cdk/scrolling';
import { NgClass, NgTemplateOutlet } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ContentChild,
  Directive,
  ElementRef,
  EventEmitter,
  Injector,
  NgZone,
  OnDestroy,
  Output,
  TemplateRef,
  ViewChild,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { GridSelection } from '@core/services/selection/grid-selection';
import { ScrollPosition } from '@core/services/scroll-position/scroll-position';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideLayoutGrid, lucideRows3 } from '@ng-icons/lucide';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { Subject } from 'rxjs';
import {
  DAY_HEADER_HEIGHT,
  GRID_CELL,
  GridLayoutPreference,
  JUSTIFIED_GAP,
  MONTH_HEADER_HEIGHT,
  SQUARE_GAP,
  YEAR_HEADER_HEIGHT,
  justifiedTargetHeight,
  squareColumns,
} from './grid-layout';

export interface TimelineMonth {
  year: number;
  month: number;
  count: number;
}

export interface TimelineData {
  months: TimelineMonth[];
  total: number;
}

/** A run of items (indexes into `items`) that a header can select at once. */
interface Span {
  start: number;
  end: number;
}

export type GridRow<T> =
  | {
      type: 'photos';
      items: T[];
      start: number;
      height: number;
      /** Aspect ratios per item for a justified row; null for squares. */
      aspects: number[] | null;
      /** A full justified row stretches to the width; the last row of a day does not. */
      full: boolean;
    }
  | { type: 'year-header'; year: number; height: number; first: boolean }
  | ({
      type: 'month-header';
      year: number;
      month: number;
      monthName: string;
      height: number;
    } & Span)
  | ({ type: 'day-header'; key: number; label: string; height: number } & Span)
  /** The `leading` template (e.g. sub-albums), first row, scrolls with the grid. */
  | { type: 'leading'; height: number };

/** Emits the element's height whenever it changes. */
@Directive({ selector: '[ogMeasureHeight]' })
export class MeasureHeight implements OnDestroy {
  readonly heightChange = output<number>({ alias: 'ogMeasureHeight' });
  private readonly observer = new ResizeObserver(([entry]) => {
    if (entry) this.heightChange.emit(Math.ceil(entry.contentRect.height));
  });

  constructor() {
    this.observer.observe(inject(ElementRef).nativeElement as Element);
  }

  ngOnDestroy(): void {
    this.observer.disconnect();
  }
}


class GridVirtualScrollStrategy implements VirtualScrollStrategy {
  private readonly _scrolledIndexChange = new Subject<number>();
  readonly scrolledIndexChange = this._scrolledIndexChange.asObservable();
  private _viewport: CdkVirtualScrollViewport | null = null;
  private _heights: number[] = [];
  private _cum: number[] = [0];
  private _maxBuf = 800;
  // Extra scrollable space appended after the last row so content can scroll
  // clear of the fixed mobile bottom nav (0 on desktop). Folded into the total
  // height only; it never affects index/offset math, which stays row-based.
  private _bottomPadding = 0;

  setBottomPadding(px: number): void {
    if (px === this._bottomPadding) return;
    this._bottomPadding = px;
    if (this._viewport) this._updateTotal();
  }

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
    return (this._cum[this._cum.length - 1] ?? 0) + this._bottomPadding;
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

const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULL_MONTH_NAMES = [
  '',
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const dayLabel = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

const AUTOSCROLL_EDGE_PX = 64;
const AUTOSCROLL_MAX_SPEED = 24;
// The rail track is inset by py-6 (24px) top and bottom.
const RAIL_PADDING_Y = 24;

@Component({
  selector: 'app-virtual-thumbnail-grid',
  standalone: true,
  imports: [ScrollingModule, NgClass, NgTemplateOutlet, NgIcon, HlmIcon, MeasureHeight],
  providers: [
    { provide: VIRTUAL_SCROLL_STRATEGY, useFactory: () => new GridVirtualScrollStrategy() },
    provideIcons({ lucideLayoutGrid, lucideRows3 }),
  ],
  host: {
    class: 'block h-full',
  },
  styles: `
    :host .cdk-virtual-scroll-viewport {
      overflow-x: hidden;
      scrollbar-width: thin;
      scrollbar-color: color-mix(in oklab, var(--muted-foreground) 30%, transparent) transparent;
    }
    :host .cdk-virtual-scroll-viewport::-webkit-scrollbar {
      width: 6px;
      height: 0;
    }
    :host .cdk-virtual-scroll-viewport::-webkit-scrollbar-thumb {
      background-color: color-mix(in oklab, var(--muted-foreground) 30%, transparent);
      border-radius: 9999px;
    }
    :host .cdk-virtual-scroll-viewport::-webkit-scrollbar-track {
      background: transparent;
      margin: 4px 0;
    }
    /* The timeline rail replaces the scrollbar on desktop. */
    @media (min-width: 768px) {
      :host .hide-scrollbar {
        scrollbar-width: none;
      }
      :host .hide-scrollbar::-webkit-scrollbar {
        display: none;
      }
    }
    :host .dragging {
      user-select: none;
      -webkit-user-select: none;
    }
  `,
  template: `
    <div class="relative flex h-full w-full">
      <cdk-virtual-scroll-viewport
        class="block h-full min-w-0 flex-1"
        [class.hide-scrollbar]="showTimelineRail()"
        [class.dragging]="selectDragging()"
        (scroll)="onScroll()"
        (pointerdown)="onViewportPointerDown($event)"
      >
        <div
          *cdkVirtualFor="let row of gridRows(); trackBy: trackRow"
          [style.height.px]="row.height"
        >
          @if (row.type === 'leading') {
            <div (ogMeasureHeight)="leadingHeight.set($event)">
              <ng-container *ngTemplateOutlet="leading()" />
            </div>
          } @else if (row.type === 'year-header') {
            <div class="flex h-full items-center justify-between gap-2 px-1">
              <h2 class="text-foreground/85 text-3xl font-bold tracking-tight tabular-nums">
                {{ row.year || 'No Date' }}
              </h2>
              @if (row.first && aspectAvailable() && layout() === 'auto') {
                <button
                  type="button"
                  class="text-muted-foreground hover:text-foreground hover:bg-muted grid size-9 place-items-center rounded-full transition-[background-color,color,scale] duration-150 active:scale-[0.96]"
                  [attr.aria-label]="isJustified() ? 'Show as squares' : 'Show whole photos'"
                  [attr.title]="isJustified() ? 'Show as squares' : 'Show whole photos'"
                  (click)="layoutPref.toggle()"
                >
                  <ng-icon hlm size="sm" [name]="isJustified() ? 'lucideLayoutGrid' : 'lucideRows3'" />
                </button>
              }
            </div>
          } @else if (row.type === 'month-header' || row.type === 'day-header') {
            <div class="flex h-full items-end gap-1.5 px-1 pb-2">
              @if (row.type === 'month-header') {
                <h3 class="text-foreground text-base font-semibold text-balance">
                  {{ row.monthName }} {{ row.year }}
                </h3>
              } @else {
                <h4 class="text-muted-foreground text-sm font-medium">{{ row.label }}</h4>
              }
            </div>
          } @else if (row.aspects) {
            <div class="flex" [style.gap.px]="JUSTIFIED_GAP" [style.height.px]="row.height - JUSTIFIED_GAP">
              @for (item of row.items; track trackItem($index, item); let i = $index) {
                <div
                  class="h-full min-w-0"
                  [style.flex]="
                    row.full
                      ? row.aspects[i] + ' 1 0px'
                      : '0 0 ' + row.aspects[i] * (row.height - JUSTIFIED_GAP) + 'px'
                  "
                >
                  <ng-container
                    *ngTemplateOutlet="itemTpl; context: templateCtx(item); injector: cellInjector"
                  ></ng-container>
                </div>
              }
            </div>
          } @else {
            <div
              class="grid"
              [style.gap.px]="SQUARE_GAP"
              [style.grid-template-columns]="gridTemplateColumns()"
            >
              @for (item of row.items; track trackItem($index, item)) {
                <ng-container
                  *ngTemplateOutlet="itemTpl; context: templateCtx(item); injector: cellInjector"
                ></ng-container>
              }
            </div>
          }
        </div>
      </cdk-virtual-scroll-viewport>

      <!-- Touch fast-scroll handle (phones and tablets), Google Photos style:
           appears while scrolling, drag it to scrub through time. -->
      @if (fastScrollAvailable() || showTimelineRail()) {
        <div
          #handleTrack
          class="pointer-events-none absolute inset-y-0 right-0 w-12 md:hidden"
          aria-hidden="true"
        >
          <div
            class="pointer-events-auto absolute right-0 flex h-10 w-11 -translate-y-1/2 touch-none items-center justify-center rounded-l-full shadow-md ring-1 transition-opacity duration-200 select-none"
            [class]="
              handleDragging()
                ? 'bg-primary text-primary-foreground ring-primary'
                : 'glass-strong text-popover-foreground'
            "
            [style.opacity]="timelineVisible() || handleDragging() ? 1 : 0"
            [style.pointer-events]="timelineVisible() || handleDragging() ? 'auto' : 'none'"
            [style.top]="handleTop()"
            (pointerdown)="onHandlePointerDown($event)"
          >
            <svg width="12" height="18" viewBox="0 0 12 18" fill="none" aria-hidden="true">
              <path d="M2 6.5 6 2.5l4 4M2 11.5l4 4 4-4" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </div>
          @if (handleDragging() && handleLabel()) {
            <div
              class="glass-strong text-popover-foreground absolute right-14 -translate-y-1/2 rounded-full px-3 py-1.5 text-sm font-semibold whitespace-nowrap tabular-nums"
              [style.top]="handleTop()"
            >
              {{ handleLabel() }}
            </div>
          }
        </div>
      }

      @if (showTimelineRail()) {
        <div
          #timelineEl
          class="focus-visible:ring-ring relative hidden h-full shrink-0 overflow-visible rounded-md outline-none select-none focus-visible:ring-2 md:block"
          style="width: 48px"
          tabindex="0"
          role="slider"
          aria-label="Timeline"
          aria-orientation="vertical"
          aria-valuemin="0"
          aria-valuemax="100"
          [attr.aria-valuenow]="currentTimelinePositionRounded()"
          [attr.aria-valuetext]="activeLabel()"
          (mouseenter)="onTimelineHover(true)"
          (mouseleave)="onTimelineHover(false)"
          (mousemove)="onTimelineMouseMove($event)"
          (mousedown)="onTimelineMouseDown($event)"
          (keydown)="onTimelineKeydown($event)"
          (focus)="showTimelineTemporarily()"
        >
          <div
            class="relative h-full w-full py-6 transition-opacity duration-300 ease-out"
            [style.opacity]="timelineVisible() || timelineHovered() || isDragging() ? 1 : 0.4"
          >
            <div class="relative h-full w-full">
              <div
                class="bg-foreground/15 absolute top-0 bottom-0 left-1/2 w-px -translate-x-1/2 rounded-full"
                aria-hidden="true"
              ></div>

              <!-- Current position indicator -->
              @if (showCurrentTimelineIndicator()) {
                <div
                  class="absolute left-1/2 z-10 -translate-x-1/2 -translate-y-1/2 transition-[top] duration-150 ease-out"
                  [style.top.%]="currentTimelinePosition()"
                >
                  <div class="bg-foreground h-[3px] w-3.5 rounded-full shadow-sm"></div>
                </div>
              }

              <!-- Tick marks: every year boundary gets a small tick, even
                   when its label is thinned out, so the scale stays legible. -->
              @for (tick of yearTicks(); track tick.position) {
                <div
                  class="bg-foreground/25 absolute left-1/2 h-px w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
                  [style.top.%]="tick.position"
                  aria-hidden="true"
                ></div>
              }

              <!-- Month dots: one per month, shown when the parent opts in (e.g. single-year view). -->
              @if (showMonthDots()) {
                @for (dot of monthDotsData(); track dot.year + '-' + dot.month) {
                  <button
                    type="button"
                    tabindex="-1"
                    class="absolute left-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-[background-color,scale] duration-150"
                    [style.top.%]="dot.position"
                    [attr.aria-label]="dot.monthName + ' ' + dot.year"
                    [ngClass]="
                      dot.year === activeTimelineMarker()?.year && dot.monthName === activeTimelineMarker()?.month
                        ? 'bg-foreground scale-125'
                        : 'bg-foreground/40 hover:bg-foreground/80 hover:scale-110'
                    "
                    (click)="jumpToTimelineMonth(dot); $event.stopPropagation()"
                  ></button>
                }
              }

              @for (marker of displayedYearMarkers(); track marker.year) {
                <button
                  type="button"
                  tabindex="-1"
                  class="group absolute left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full px-2 py-0.5 text-[11px] font-bold whitespace-nowrap tabular-nums transition-[background-color,color,box-shadow,scale] duration-200 ease-out active:scale-[0.96]"
                  [style.top.%]="marker.position"
                  [ngClass]="
                    marker.year === activeTimelineMarker()?.year
                      ? 'bg-background text-foreground ring-foreground/20 shadow-sm ring-1'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  "
                  (click)="jumpToTimelineMonth(marker); $event.stopPropagation()"
                >
                  {{ marker.year }}
                </button>
              }

              <!-- Hover / drag tooltip -->
              @if ((timelineHovered() || isDragging()) && hoverTimelineLabel()) {
                <div
                  class="glass-strong text-popover-foreground pointer-events-none absolute right-full mr-2 -translate-y-1/2 rounded-xl px-3 py-1.5 text-left whitespace-nowrap"
                  [style.top.%]="hoverTimelinePosition() ?? currentTimelinePosition()"
                >
                  <div class="text-xs leading-none font-semibold tabular-nums">
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
  protected readonly selection = inject(GridSelection, { optional: true });
  protected readonly layoutPref = inject(GridLayoutPreference);
  private scrollRestoreState: 'pending' | 'restoring' | 'done' = 'pending';
  private targetScrollPosition: number | null = null;
  private restoreAttempts = 0;
  private readonly MAX_RESTORE_ATTEMPTS = 10;
  private readonly MONTH_NAMES = MONTH_NAMES;

  items = input<readonly T[] | null>([]);
  /** @deprecated Kept for callers; columns follow the width. */
  minTilePx = input(100);
  hasMore = input(false);
  isLoadingMore = input(false);
  scrollKey = input<string | null>(null);
  pageCount = input(0);
  dateAccessor = input<(item: T) => Date | string | null | undefined>(() => null);
  timelineData = input<TimelineData | null>(null);
  showMonthDots = input(false);
  rowHeightExtra = input(0); // Extra height for content below thumbnail (e.g., album name)
  /**
   * 'auto' uses justified rows (whole photos, Google Photos style) when the
   * items carry width/height and the viewer has not picked squares. 'squares'
   * always uses square tiles.
   */
  layout = input<'auto' | 'squares'>('auto');
  /** Group by day under each month (each day gets a selectable header). */
  dayHeaders = input(true);
  // Off for items with no dates (e.g. albums): no year/month/day headers, so
  // no lone "No Date" header above the grid.
  dateHeaders = input(true);

  @Output() loadMore = new EventEmitter<void>();
  @Output() seekTo = new EventEmitter<{ year: number; month: number }>();

  @ContentChild(TemplateRef) itemTpl!: TemplateRef<{ $implicit: T }>;
  @ViewChild(CdkVirtualScrollViewport) viewport!: CdkVirtualScrollViewport;
  @ViewChild('timelineEl') timelineEl!: ElementRef<HTMLElement>;
  @ViewChild('handleTrack') handleTrack?: ElementRef<HTMLElement>;

  private readonly scrollStrategy = inject(VIRTUAL_SCROLL_STRATEGY) as GridVirtualScrollStrategy;
  protected readonly SQUARE_GAP = SQUARE_GAP;
  protected readonly JUSTIFIED_GAP = JUSTIFIED_GAP;

  private readonly width = signal(0);
  protected readonly timelineVisible = signal(false);
  protected readonly timelineHovered = signal(false);
  protected readonly isDragging = signal(false);
  protected readonly activeRowIndex = signal(0);
  private readonly atScrollBottom = signal(false);
  private readonly scrollFraction = signal(0);
  private readonly viewportHeight = signal(0);
  protected readonly hoverTimelinePosition = signal<number | null>(null);
  protected readonly hoverTimelineLabel = signal<string | null>(null);
  protected readonly handleDragging = signal(false);
  protected readonly handleLabel = signal<string | null>(null);
  private readonly handleFraction = signal<number | null>(null);
  protected readonly selectDragging = signal(false);
  private resizeObs: ResizeObserver | null = null;
  private timelineHideTimeout: ReturnType<typeof setTimeout> | null = null;
  private seekTargetYearMonth: { year: number; month: number } | null = null;
  private pendingScrubTarget: { year: number; month: number; offset: number } | null = null;
  private boundDragMove: ((e: MouseEvent) => void) | null = null;
  private boundDragEnd: (() => void) | null = null;
  private teardown: (() => void)[] = [];

  // ---- Layout --------------------------------------------------------------

  /** True when most items carry width/height, so justified rows are possible. */
  protected readonly aspectAvailable = computed(() => {
    const items = this.items() ?? [];
    if (!items.length) return false;
    const step = Math.max(1, Math.floor(items.length / 200));
    let seen = 0;
    let withAspect = 0;
    for (let i = 0; i < items.length; i += step) {
      seen++;
      const it = items[i] as { width?: unknown; height?: unknown };
      if (typeof it?.width === 'number' && typeof it?.height === 'number' && it.width > 0 && it.height > 0)
        withAspect++;
    }
    return withAspect / seen >= 0.5;
  });

  protected readonly isJustified = computed(
    () =>
      this.layout() === 'auto' &&
      this.layoutPref.mode() === 'justified' &&
      this.rowHeightExtra() === 0 &&
      this.aspectAvailable(),
  );

  columns = computed(() => squareColumns(this.width()));

  gridTemplateColumns = computed(() => `repeat(${this.columns()}, 1fr)`);

  // Square tile plus the gap below it (and any caption space).
  rowHeight = computed(() => {
    const w = this.width();
    const cols = this.columns();
    const tile = Math.floor((w - (cols - 1) * SQUARE_GAP) / cols);
    return Math.max(120, tile) + SQUARE_GAP + this.rowHeightExtra();
  });

  private readonly tileWidth = computed(() =>
    this.isJustified() ? justifiedTargetHeight(this.width()) * 1.5 : this.rowHeight() - SQUARE_GAP,
  );

  /** Injector for each cell, so thumbnails know the layout (see GRID_CELL). */
  protected readonly cellInjector = Injector.create({
    providers: [
      { provide: GRID_CELL, useValue: { justified: this.isJustified, tileWidth: this.tileWidth } },
    ],
    parent: inject(Injector),
  });

  private aspectOf(item: T): number {
    const it = item as { width?: number | null; height?: number | null };
    const w = it?.width ?? 0;
    const h = it?.height ?? 0;
    if (!(w > 0 && h > 0)) return 1;
    return Math.min(3.5, Math.max(0.4, w / h));
  }

  /** Rows and their heights, built in one pass over the items. */
  private readonly layoutResult = computed(() => {
    const items = (this.items() ?? []) as readonly T[];
    const width = this.width();
    const rows: GridRow<T>[] = [];
    if (!items.length || width <= 0) return rows;

    const da = this.dateAccessor();
    const justified = this.isJustified();
    const days = this.dayHeaders();
    const cols = this.columns();
    const squareH = this.rowHeight();
    const targetH = justifiedTargetHeight(width);
    const maxH = targetH * 1.6;

    let lastYear = -1;
    let lastMonth = -1;
    let lastDay = -1;
    let openMonth: { end: number } | null = null;
    let openDay: { end: number } | null = null;
    let chunkStart = 0;
    let firstYear = true;

    const flush = (end: number) => {
      if (end <= chunkStart) return;
      if (!justified) {
        for (let i = chunkStart; i < end; i += cols) {
          rows.push({
            type: 'photos',
            items: items.slice(i, Math.min(i + cols, end)) as T[],
            start: i,
            height: squareH,
            aspects: null,
            full: true,
          });
        }
      } else {
        let rowStart = chunkStart;
        let sum = 0;
        for (let i = chunkStart; i < end; i++) {
          sum += this.aspectOf(items[i]);
          const n = i - rowStart + 1;
          if (sum * targetH + (n - 1) * JUSTIFIED_GAP >= width) {
            const h = Math.min(maxH, (width - (n - 1) * JUSTIFIED_GAP) / sum);
            rows.push(this.justifiedRow(items, rowStart, i + 1, h, true));
            rowStart = i + 1;
            sum = 0;
          }
        }
        if (rowStart < end) rows.push(this.justifiedRow(items, rowStart, end, targetH, false));
      }
      chunkStart = end;
    };

    for (let i = 0; this.dateHeaders() && i < items.length; i++) {
      const d = this.parseTimelineDate(da(items[i]));
      const y = d?.getFullYear() ?? 0;
      const m = d ? d.getMonth() + 1 : 0;
      const day = d ? d.getDate() : 0;
      const yearChanged = y !== lastYear;
      const monthChanged = yearChanged || m !== lastMonth;
      const dayChanged = monthChanged || (days && day !== lastDay);
      if (!dayChanged) continue;

      flush(i);
      if (openDay) openDay.end = i;
      if (monthChanged && openMonth) openMonth.end = i;

      // Undated items (sorted last by the API) get one "No Date" header; year 0
      // marks it.
      if (yearChanged) {
        rows.push({ type: 'year-header', year: y, height: YEAR_HEADER_HEIGHT, first: firstYear });
        firstYear = false;
      }
      if (monthChanged && y && m) {
        const row = {
          type: 'month-header' as const,
          year: y,
          month: m,
          monthName: FULL_MONTH_NAMES[m] || '',
          height: MONTH_HEADER_HEIGHT,
          start: i,
          end: items.length,
        };
        rows.push(row);
        openMonth = row;
      } else if (monthChanged) {
        openMonth = null;
      }
      if (days && d && y) {
        const row = {
          type: 'day-header' as const,
          key: y * 10000 + m * 100 + day,
          label: dayLabel.format(d),
          height: DAY_HEADER_HEIGHT,
          start: i,
          end: items.length,
        };
        rows.push(row);
        openDay = row;
      } else {
        openDay = null;
      }
      lastYear = y;
      lastMonth = m;
      lastDay = day;
    }
    flush(items.length);
    return rows;
  });

  private justifiedRow(
    items: readonly T[],
    start: number,
    end: number,
    h: number,
    full: boolean,
  ): GridRow<T> {
    const slice = items.slice(start, end) as T[];
    return {
      type: 'photos',
      items: slice,
      start,
      height: Math.round(h) + JUSTIFIED_GAP,
      aspects: slice.map((it) => this.aspectOf(it)),
      full,
    };
  }

  /** Content above the first row that scrolls away with the grid. */
  leading = input<TemplateRef<unknown> | null>(null);
  // Measured by the leading row itself; a guess until the first measure.
  protected readonly leadingHeight = signal(160);

  readonly gridRows = computed((): GridRow<T>[] => {
    const rows = this.layoutResult();
    if (!this.leading() || !rows.length) return rows;
    return [{ type: 'leading', height: Math.max(1, this.leadingHeight()) }, ...rows];
  });

  private readonly _rowHeights = computed(() => this.gridRows().map((r) => r.height));

  private readonly _rowCumulative = computed(() => {
    const cum = [0];
    for (const h of this._rowHeights()) cum.push(cum[cum.length - 1] + h);
    return cum;
  });

  rows = computed(() => this.gridRows().filter((r) => r.type === 'photos'));

  // ---- Selection helpers ---------------------------------------------------

  // '' for items that cannot be selected (no id, or an import placeholder).
  private readonly itemIds = computed(() =>
    ((this.items() ?? []) as readonly T[]).map((it) => {
      const x = it as { id?: string; loading?: boolean } | null;
      return x && !x.loading ? (x.id ?? '') : '';
    }),
  );

  private readonly indexById = computed(() => {
    const map = new Map<string, number>();
    this.itemIds().forEach((id, i) => map.set(id, i));
    return map;
  });

  // ---- Desktop drag-select (Google style: press on a check circle, or on
  // any tile while in select mode, then drag across tiles) ------------------

  private drag: {
    anchorIdx: number;
    mode: boolean;
    base: ReadonlySet<string>;
    moved: boolean;
    x: number;
    y: number;
    raf: number | null;
  } | null = null;

  private idFromPoint(x: number, y: number): string | null {
    const el = document.elementFromPoint(x, y);
    const host = el?.closest('app-asset-thumbnail');
    return host?.querySelector('[data-asset-id]')?.getAttribute('data-asset-id') ?? null;
  }

  protected onViewportPointerDown(event: PointerEvent): void {
    const sel = this.selection;
    if (!sel || event.pointerType !== 'mouse' || event.button !== 0) return;
    if (event.shiftKey || event.metaKey || event.ctrlKey) return;
    const target = event.target as Element | null;
    const onCheck = !!target?.closest('[data-select-check]');
    if (!onCheck && !sel.active()) return;
    const id = this.idFromPoint(event.clientX, event.clientY);
    const idx = id ? this.indexById().get(id) : undefined;
    if (id == null || idx == null) return;

    event.preventDefault();
    this.drag = {
      anchorIdx: idx,
      mode: !sel.isSelected(id),
      base: new Set(sel.ids()),
      moved: false,
      x: event.clientX,
      y: event.clientY,
      raf: null,
    };

    const move = (e: PointerEvent) => {
      if (!this.drag) return;
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      this.extendDrag();
      this.ensureAutoScroll();
    };
    const up = () => {
      const d = this.drag;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (d?.raf != null) cancelAnimationFrame(d.raf);
      this.drag = null;
      if (d?.moved) {
        sel.suppressNextClick();
        this.ngZone.run(() => this.selectDragging.set(false));
      }
    };
    this.ngZone.runOutsideAngular(() => {
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
  }

  private extendDrag(): void {
    const d = this.drag;
    const sel = this.selection;
    if (!d || !sel) return;
    const id = this.idFromPoint(d.x, d.y);
    const idx = id ? this.indexById().get(id) : undefined;
    if (idx == null) return;
    if (!d.moved && idx === d.anchorIdx) return;
    if (!d.moved) {
      d.moved = true;
      this.ngZone.run(() => this.selectDragging.set(true));
    }
    const [a, b] = idx < d.anchorIdx ? [idx, d.anchorIdx] : [d.anchorIdx, idx];
    const ids = this.itemIds();
    const next = new Set(d.base);
    for (let i = a; i <= b; i++) {
      if (!ids[i]) continue;
      if (d.mode) next.add(ids[i]);
      else next.delete(ids[i]);
    }
    this.ngZone.run(() => {
      sel.replace(next);
      sel.setAnchor(ids[idx]);
    });
  }

  private ensureAutoScroll(): void {
    const d = this.drag;
    if (!d || d.raf != null || !this.viewport) return;
    const step = () => {
      const cur = this.drag;
      if (!cur || !this.viewport) return;
      const rect = this.viewport.elementRef.nativeElement.getBoundingClientRect();
      let dy = 0;
      if (cur.y < rect.top + AUTOSCROLL_EDGE_PX)
        dy = -AUTOSCROLL_MAX_SPEED * Math.min(1, (rect.top + AUTOSCROLL_EDGE_PX - cur.y) / AUTOSCROLL_EDGE_PX);
      else if (cur.y > rect.bottom - AUTOSCROLL_EDGE_PX)
        dy = AUTOSCROLL_MAX_SPEED * Math.min(1, (cur.y - (rect.bottom - AUTOSCROLL_EDGE_PX)) / AUTOSCROLL_EDGE_PX);
      if (dy === 0) {
        cur.raf = null;
        return;
      }
      const el = this.viewport.elementRef.nativeElement;
      el.scrollTop += dy;
      this.extendDrag();
      cur.raf = requestAnimationFrame(step);
    };
    d.raf = requestAnimationFrame(step);
  }

  private onWindowKeydown = (event: KeyboardEvent) => {
    const sel = this.selection;
    if (!sel) return;
    const target = event.target as HTMLElement | null;
    const editable =
      !!target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
    if (editable || document.querySelector('.cdk-overlay-pane')) return;

    if (event.key === 'Escape' && sel.active()) {
      // Clear first; a second Escape can then go back a page.
      event.preventDefault();
      event.stopImmediatePropagation();
      this.ngZone.run(() => sel.clear());
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      this.ngZone.run(() => sel.setMany(this.itemIds().filter(Boolean), true));
    }
  };

  // On mobile reserve a strip of scrollable space below the last row. When the
  // floating selection bar is up on a wider screen, reserve room for it too.
  protected readonly bottomInset = computed(() => {
    const w = this.width();
    const mobile = w > 0 && w < 640 ? 80 : 0;
    const bar = this.selection?.active() && w >= 640 ? 88 : 0;
    return mobile + bar;
  });

  constructor() {
    // Keep custom scroll strategy in sync with row heights
    effect(() => {
      const heights = this._rowHeights();
      const rowH = this.rowHeight();
      this.scrollStrategy.updateConfig(heights, rowH * 3, rowH * 6);
    });

    effect(() => {
      this.scrollStrategy.setBottomPadding(this.bottomInset());
      this.viewport?.checkViewportSize();
    });

    // Effect to handle scroll restoration when items load
    effect(() => {
      const rows = this.rows();
      const key = this.scrollKey();

      if (this.viewport && rows.length > 0) {
        this.viewport.checkViewportSize();

        if (this.scrollRestoreState === 'pending' && key) {
          this.initScrollRestoration(key);
        }

        this.checkIfNeedsMoreContent();
        this.checkSeekTarget();
      }
    });

    this.selection?.register(
      () => this.itemIds(),
      (id) => {
        const idx = this.indexById().get(id);
        if (idx == null) return null;
        const it = (this.items() ?? [])[idx] as { type?: 'image' | 'video' } | undefined;
        return { id, type: it?.type === 'video' ? 'video' : 'image' };
      },
    );

    if (typeof window !== 'undefined' && this.selection) {
      this.ngZone.runOutsideAngular(() =>
        window.addEventListener('keydown', this.onWindowKeydown, true),
      );
      this.teardown.push(() => window.removeEventListener('keydown', this.onWindowKeydown, true));
    }
  }

  private checkIfNeedsMoreContent(): void {
    if (!this.hasMore() || this.isLoadingMore() || !this.viewport) return;

    requestAnimationFrame(() => {
      if (!this.viewport) return;
      const viewportHeight = this.viewport.getViewportSize();
      const contentHeight = this.scrollStrategy.totalHeight;
      if (contentHeight < viewportHeight * 1.2) {
        this.loadMore.emit();
      }
    });
  }

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

  /** Small ticks at every year boundary (cheap, never crowded since it's
   *  one per year and years are spread by MIN_YEAR_GAP). */
  protected readonly yearTicks = computed(() =>
    this.yearMarkers().map((m) => ({ position: m.position })),
  );

  protected readonly monthDotsData = computed(() => {
    const { months, monthPositions, total } = this.timelineLogScale();
    if (!months.length || !total) return [] as { position: number; year: number; month: number; monthName: string; offset: number; count: number }[];
    return months.map((m, i) => ({ position: monthPositions[i], year: m.year, month: m.month, monthName: m.monthName, offset: m.offset, count: m.count }));
  });

  /** Year labels, thinned so they never overlap regardless of how many years
   *  the library spans. Always keeps the first and last year; drops interior
   *  labels that fall within MIN_LABEL_GAP_PCT of the previously kept one.
   *  Dropped years still get a tick (yearTicks) and remain reachable via
   *  hover/drag scrubbing. Mirrors Google Photos' sparse year scale. */
  protected readonly displayedYearMarkers = computed(() => {
    const markers = this.yearMarkers();
    if (markers.length <= 2) return markers;

    const MIN_LABEL_GAP_PCT = 6; // ~ one 11px label + breathing room
    const active = this.activeTimelineMarker()?.year ?? null;
    const lastIdx = markers.length - 1;
    const kept: typeof markers = [];
    let lastPos = -Infinity;

    for (let i = 0; i < markers.length; i++) {
      const m = markers[i];
      const isAnchor = i === 0 || i === lastIdx || m.year === active;
      if (isAnchor || m.position - lastPos >= MIN_LABEL_GAP_PCT) {
        kept.push(m);
        lastPos = m.position;
      }
    }
    return kept;
  });

  /** The first photo row at or after the active row, and its first item's date. */
  private activeRowDate(): { rowIdx: number; date: Date } | null {
    const allRows = this.gridRows();
    let rowIdx = this.activeRowIndex();
    while (rowIdx < allRows.length && allRows[rowIdx].type !== 'photos') rowIdx++;
    const gridRow = allRows[rowIdx];
    if (!gridRow || gridRow.type !== 'photos') return null;
    const source = gridRow.items[0];
    const date = source ? this.parseTimelineDate(this.dateAccessor()(source)) : null;
    return date ? { rowIdx, date } : null;
  }

  /** Map the current scroll position to a percentage on the timeline.
   *  Reads the actual date from the visible row to find the correct month
   *  in server timeline data, then interpolates within that month based on
   *  how far through it the user has scrolled. */
  protected readonly currentTimelinePosition = computed(() => {
    const data = this.timelineData();
    if (!data?.total) return 0;
    if (this.atScrollBottom()) return 100;

    const months = this.timelineMonthsWithOffset();
    if (!months.length) return 0;

    const active = this.activeRowDate();
    if (!active) return 0;
    const { rowIdx, date } = active;
    const allRows = this.gridRows();

    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    const serverMonth = months.find((entry) => entry.year === y && entry.month === m);
    if (!serverMonth) return 0;

    // Count photos between the month header and the current row.
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

  protected readonly currentTimelinePositionRounded = computed(() =>
    Math.round(this.currentTimelinePosition()),
  );

  protected readonly activeTimelineMarker = computed(() => {
    const months = this.timelineMonthsWithOffset();
    if (!months.length) return null;

    const date = this.activeRowDate()?.date ?? null;
    if (date) {
      const y = date.getFullYear();
      const m = date.getMonth() + 1;
      const found = months.find((entry) => entry.year === y && entry.month === m);
      if (found) return { year: found.year, month: found.monthName };
    }
    return months[0] ? { year: months[0].year, month: months[0].monthName } : null;
  });

  /** "Oct 2024" for the row at the top of the viewport. */
  protected readonly activeLabel = computed(() => {
    const date = this.activeRowDate()?.date;
    return date ? `${MONTH_NAMES[date.getMonth() + 1]} ${date.getFullYear()}` : null;
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

  /** Long grids (about 4 screens or more) get the touch fast-scroll handle. */
  protected readonly fastScrollAvailable = computed(() => {
    const vh = this.viewportHeight();
    const cum = this._rowCumulative();
    return vh > 0 && (cum[cum.length - 1] ?? 0) > vh * 4;
  });

  /** Where the touch handle sits: on the timeline scale when there is one. */
  protected readonly handleTop = computed(() => {
    const dragged = this.handleFraction();
    const f =
      dragged ??
      (this.showTimelineRail() ? this.currentTimelinePosition() / 100 : this.scrollFraction());
    const pad = RAIL_PADDING_Y;
    return `calc(${pad}px + (100% - ${pad * 2}px) * ${Math.min(1, Math.max(0, f))})`;
  });

  trackRow = (index: number, row: GridRow<T>): string => {
    if (row.type === 'leading') return 'leading';
    if (row.type === 'year-header') return `year-${row.year}`;
    if (row.type === 'month-header') return `month-${row.year}-${row.month}`;
    if (row.type === 'day-header') return `day-${row.key}`;
    if (!row.items.length) return `empty-${index}`;
    const firstItem = row.items[0] as { id?: string };
    return firstItem?.id ?? `row-${index}`;
  };

  protected trackItem(index: number, item: T): string | number {
    return (item as { id?: string })?.id ?? index;
  }

  templateCtx(item: T): { $implicit: T } {
    return { $implicit: item } as { $implicit: T };
  }

  // ---- Desktop rail ----------------------------------------------------------

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

  private railPercent(clientY: number): number | null {
    const el = this.timelineEl?.nativeElement;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const trackTop = rect.top + RAIL_PADDING_Y;
    const trackHeight = rect.height - RAIL_PADDING_Y * 2;
    if (trackHeight <= 0) return null;
    return Math.min(1, Math.max(0, (clientY - trackTop) / trackHeight));
  }

  protected onTimelineMouseMove(event: MouseEvent): void {
    if (this.isDragging()) return; // Drag handler takes over
    const percent = this.railPercent(event.clientY);
    if (percent == null) return;
    const targetMonth = this.timelinePercentToMonth(percent);
    if (!targetMonth) return;

    this.hoverTimelinePosition.set(percent * 100);
    this.hoverTimelineLabel.set(`${targetMonth.monthName} ${targetMonth.year}`);
  }

  protected onTimelineMouseDown(event: MouseEvent): void {
    event.preventDefault();
    this.timelineEl?.nativeElement.focus({ preventScroll: true });
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
      this.flushPendingScrub();
    };

    document.addEventListener('mousemove', this.boundDragMove);
    document.addEventListener('mouseup', this.boundDragEnd);
  }

  private handleTimelineInteraction(event: MouseEvent): void {
    const percent = this.railPercent(event.clientY);
    if (percent == null) return;
    const targetMonth = this.timelinePercentToMonth(percent);
    if (!targetMonth) return;

    this.hoverTimelinePosition.set(percent * 100);
    this.hoverTimelineLabel.set(`${targetMonth.monthName} ${targetMonth.year}`);
    this.showTimelineTemporarily();
    this.scrubToMonth(targetMonth);
  }

  /**
   * While scrubbing, scroll at once when the month is loaded. A month that is
   * not loaded yet is only fetched when the drag ends, so a fast drag does not
   * fire a query for every month it passes.
   */
  private scrubToMonth(target: { year: number; month: number; offset: number }): void {
    if (this.scrollToLoadedMonth(target.year, target.month)) {
      this.pendingScrubTarget = null;
    } else {
      this.pendingScrubTarget = target;
    }
  }

  private flushPendingScrub(): void {
    const t = this.pendingScrubTarget;
    this.pendingScrubTarget = null;
    if (t) this.jumpToTimelineMonth(t);
  }

  protected onTimelineKeydown(event: KeyboardEvent): void {
    if (!this.viewport) return;
    const vh = this.viewport.getViewportSize();
    const top = this.viewport.measureScrollOffset('top');
    const months = this.timelineMonthsWithOffset();
    const active = this.activeRowDate()?.date;
    const activeIdx = active
      ? months.findIndex(
          (m) => m.year === active.getFullYear() && m.month === active.getMonth() + 1,
        )
      : -1;
    let handled = true;
    switch (event.key) {
      case 'PageDown':
        this.viewport.scrollToOffset(top + vh * 0.9);
        break;
      case 'PageUp':
        this.viewport.scrollToOffset(Math.max(0, top - vh * 0.9));
        break;
      case 'Home':
        if (months[0]) this.jumpToTimelineMonth(months[0]);
        else this.viewport.scrollToOffset(0);
        break;
      case 'End':
        if (months.length) this.jumpToTimelineMonth(months[months.length - 1]);
        else this.viewport.scrollToOffset(this.scrollStrategy.totalHeight);
        break;
      case 'ArrowDown':
        if (months[activeIdx + 1]) this.jumpToTimelineMonth(months[activeIdx + 1]);
        break;
      case 'ArrowUp':
        if (activeIdx > 0) this.jumpToTimelineMonth(months[activeIdx - 1]);
        else this.viewport.scrollToOffset(0);
        break;
      default:
        handled = false;
    }
    if (handled) {
      event.preventDefault();
      this.showTimelineTemporarily();
    }
  }

  // ---- Touch fast-scroll handle ---------------------------------------------

  protected onHandlePointerDown(event: PointerEvent): void {
    const handle = event.currentTarget as HTMLElement;
    event.preventDefault();
    event.stopPropagation();
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // Older browsers: the window listeners below still work.
    }
    this.handleDragging.set(true);
    this.clearTimelineHideTimeout();
    this.onHandleMove(event.clientY);

    const move = (e: PointerEvent) => {
      e.preventDefault();
      this.ngZone.run(() => this.onHandleMove(e.clientY));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      this.ngZone.run(() => {
        this.handleDragging.set(false);
        this.handleFraction.set(null);
        this.flushPendingScrub();
        this.showTimelineTemporarily();
      });
    };
    this.ngZone.runOutsideAngular(() => {
      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
  }

  private onHandleMove(clientY: number): void {
    const track = this.handleTrack?.nativeElement;
    if (!track || !this.viewport) return;
    const rect = track.getBoundingClientRect();
    const h = rect.height - RAIL_PADDING_Y * 2;
    if (h <= 0) return;
    const f = Math.min(1, Math.max(0, (clientY - rect.top - RAIL_PADDING_Y) / h));
    this.handleFraction.set(f);

    if (this.showTimelineRail()) {
      const month = this.timelinePercentToMonth(f);
      if (!month) return;
      this.handleLabel.set(`${month.monthName} ${month.year}`);
      this.scrubToMonth(month);
    } else {
      const max = Math.max(0, this.scrollStrategy.totalHeight - this.viewport.getViewportSize());
      this.viewport.scrollToOffset(f * max);
      this.handleLabel.set(this.activeLabel());
    }
  }

  // ---- Jumping ---------------------------------------------------------------

  /** Scroll to a month that is already in the loaded rows. False when it is not loaded. */
  private scrollToLoadedMonth(year: number, month: number): boolean {
    const allRows = this.gridRows();
    for (let i = 0; i < allRows.length; i++) {
      const r = allRows[i];
      if (r.type === 'month-header' && r.year === year && r.month === month) {
        this.seekTargetYearMonth = null;
        let scrollIdx = i;
        if (scrollIdx > 0 && allRows[scrollIdx - 1].type === 'year-header') scrollIdx--;
        this.viewport?.scrollToIndex(scrollIdx, 'instant');
        return true;
      }
    }
    return false;
  }

  protected jumpToTimelineMonth(marker: {
    offset: number;
    year?: number;
    month?: number;
    monthName?: string;
  }): void {
    if (!marker.year) return;

    // Resolve the target month (year-only clicks go to the first month of that year)
    let targetYear = marker.year;
    let targetMonth = marker.month;
    if (!targetMonth) {
      const months = this.timelineMonthsWithOffset();
      const firstMonth = months.find((m) => m.year === marker.year);
      if (!firstMonth) return;
      targetYear = firstMonth.year;
      targetMonth = firstMonth.month;
    }

    this.showTimelineTemporarily();
    if (this.scrollToLoadedMonth(targetYear, targetMonth)) return;

    // Not loaded: emit seekTo so the parent can reset the query to this date
    this.seekTargetYearMonth = { year: targetYear, month: targetMonth };
    this.scrollRestoreState = 'done';
    this.targetScrollPosition = null;
    const key = this.scrollKey();
    if (key) this.scrollPosition.save(key, 0);
    this.seekTo.emit({ year: targetYear, month: targetMonth });
  }

  ngAfterViewInit(): void {
    const viewportEl = this.viewport?.elementRef?.nativeElement ?? this.host.nativeElement;

    const applySize = (w: number, h: number) => {
      if (w > 0 && w !== this.width()) {
        this.ngZone.run(() => this.width.set(w));
      }
      if (h > 0 && h !== this.viewportHeight()) {
        this.ngZone.run(() => this.viewportHeight.set(h));
      }
    };

    // ResizeObserver is the primary size source; it fires at once on observe()
    this.resizeObs = new ResizeObserver((entries: ResizeObserverEntry[]) => {
      const entry = entries[0];
      applySize(
        entry?.contentRect?.width ?? viewportEl.clientWidth,
        entry?.contentRect?.height ?? viewportEl.clientHeight,
      );
      if (this.viewport) this.viewport.checkViewportSize();
    });
    this.resizeObs.observe(viewportEl);

    // Fallback chain for first load when ResizeObserver has not fired yet
    const readSize = () => {
      const rect = viewportEl.getBoundingClientRect();
      applySize(
        rect.width || viewportEl.clientWidth || viewportEl.offsetWidth,
        rect.height || viewportEl.clientHeight,
      );
    };
    readSize();
    requestAnimationFrame(() => readSize());
    setTimeout(() => readSize(), 0);
  }

  onScroll(): void {
    const key = this.scrollKey();
    if (key && this.viewport && this.scrollRestoreState === 'done') {
      this.scrollPosition.save(key, this.viewport.measureScrollOffset('top'), this.pageCount());
    }

    if (!this.viewport) return;
    const scrollTop = this.viewport.measureScrollOffset('top');
    const bottom = this.viewport.measureScrollOffset('bottom');
    this.atScrollBottom.set(bottom < 2);
    const total = scrollTop + bottom;
    this.scrollFraction.set(total > 0 ? scrollTop / total : 0);

    // Binary search the row at the top of the viewport.
    const cum = this._rowCumulative();
    let lo = 0;
    let hi = Math.max(0, cum.length - 2);
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cum[mid] <= scrollTop) lo = mid;
      else hi = mid - 1;
    }
    this.activeRowIndex.set(lo);
    this.showTimelineTemporarily();

    if (!this.hasMore() || this.isLoadingMore()) return;
    // Load more once past half of the loaded content.
    if (total > 0 && scrollTop / total > 0.5) {
      this.loadMore.emit();
    }
  }

  /** Called from the effect watching rows: if seeking, check if the target month is now loaded */
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

  protected showTimelineTemporarily(): void {
    if (!this.showTimelineRail() && !this.fastScrollAvailable()) return;
    this.timelineVisible.set(true);
    this.clearTimelineHideTimeout();
    this.timelineHideTimeout = setTimeout(() => {
      if (!this.timelineHovered() && !this.handleDragging()) {
        this.timelineVisible.set(false);
      }
    }, 1200);
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
    if (Number.isNaN(date.getTime())) return null;
    // The API sorts undated items under a year-0000 sentinel (see
    // undatedBottomSortExpr in api/src/db/file-sort.ts); that is no date.
    return date.getUTCFullYear() < 1 ? null : date;
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
    if (this.drag?.raf != null) cancelAnimationFrame(this.drag.raf);
    this.drag = null;
    for (const fn of this.teardown) fn();
  }
}
