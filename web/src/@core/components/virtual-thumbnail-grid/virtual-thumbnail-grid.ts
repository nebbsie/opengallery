import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import { NgFor, NgTemplateOutlet } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ContentChild,
  ElementRef,
  EventEmitter,
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

@Component({
  selector: 'app-virtual-thumbnail-grid',
  standalone: true,
  imports: [ScrollingModule, NgFor, NgTemplateOutlet],
  host: {
    class: 'block h-full',
  },
  styles: `
    :host .cdk-virtual-scroll-viewport {
      /* Never show horizontal scrollbar */
      overflow-x: hidden;
      /* Show a thin, unobtrusive vertical scrollbar */
      scrollbar-width: thin; /* Firefox */
      scrollbar-color: rgba(0, 0, 0, 0.35) transparent; /* Firefox */
    }
    :host .cdk-virtual-scroll-viewport::-webkit-scrollbar {
      width: 8px; /* vertical */
      height: 0; /* horizontal hidden */
    }
    :host .cdk-virtual-scroll-viewport::-webkit-scrollbar-thumb {
      background-color: rgba(0, 0, 0, 0.35);
      border-radius: 9999px;
    }
    :host .cdk-virtual-scroll-viewport::-webkit-scrollbar-track {
      background: transparent;
    }
  `,
  template: `
    <cdk-virtual-scroll-viewport
      class="block h-full w-full"
      [itemSize]="rowHeight()"
      [minBufferPx]="rowHeight() * 3"
      [maxBufferPx]="rowHeight() * 6"
      (scrolledIndexChange)="onScrollIndexChange($event)"
      (scroll)="onScroll()"
    >
      <div
        class="mb-2 grid gap-2 sm:gap-2 lg:gap-2"
        [style.grid-template-columns]="gridTemplateColumns()"
        *cdkVirtualFor="let row of rows(); trackBy: trackRow"
      >
        <ng-container *ngFor="let item of row">
          <ng-container *ngTemplateOutlet="itemTpl; context: templateCtx(item)"></ng-container>
        </ng-container>
      </div>
    </cdk-virtual-scroll-viewport>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VirtualThumbnailGrid<T = unknown> implements AfterViewInit, OnDestroy {
  private readonly host = inject(ElementRef<HTMLElement>);

  items = input<readonly T[] | null>([]);
  minTilePx = input(200); // approximate min tile width
  hasMore = input(false);
  isLoadingMore = input(false);

  @Output() loadMore = new EventEmitter<void>();

  @ContentChild(TemplateRef) itemTpl!: TemplateRef<{ $implicit: T }>;
  @ViewChild(CdkVirtualScrollViewport) viewport!: CdkVirtualScrollViewport;

  private readonly width = signal(0);
  private resizeObs: ResizeObserver | null = null;

  constructor() {
    effect(() => {
      const rows = this.rows();
      if (this.viewport && rows.length > 0) {
        this.viewport.checkViewportSize();
      }
    });
  }

  columns = computed(() => {
    const w = this.width();
    const min = Math.max(120, this.minTilePx());
    const cols = Math.max(1, Math.floor(w / min));
    return cols;
  });

  gridTemplateColumns = computed(
    () => `repeat(${this.columns()}, minmax(${this.minTilePx()}px, 1fr))`,
  );

  // Assume square tiles; include gap (approx 8px) for row height
  rowHeight = computed(() => {
    const w = this.width();
    const cols = this.columns();
    const gap = 8; // tailwind gap-2
    const tile = Math.floor((w - (cols - 1) * gap) / cols);
    return Math.max(120, tile) + gap; // include gap to avoid overlap
  });

  rows = computed(() => {
    const itemsArray = (this.items() ?? []) as readonly T[];
    const cols = this.columns();
    if (!itemsArray.length) return [] as T[][];
    const out: T[][] = [];
    for (let i = 0; i < itemsArray.length; i += cols) out.push(itemsArray.slice(i, i + cols));
    return out;
  });

  trackRow = (index: number, row: readonly T[]) => {
    if (!row.length) return index;
    const firstItem = row[0] as { id?: string };
    return firstItem?.id ?? index;
  };

  templateCtx(item: T): { $implicit: T } {
    return { $implicit: item } as { $implicit: T };
  }

  ngAfterViewInit(): void {
    const initialWidth = this.host.nativeElement.clientWidth;
    if (initialWidth > 0) {
      this.width.set(initialWidth);
    }

    this.resizeObs = new ResizeObserver((entries: ResizeObserverEntry[]) => {
      const entry = entries[0];
      const cr = entry?.contentRect as DOMRect | undefined;
      const w = cr?.width ?? this.host.nativeElement.clientWidth;
      this.width.set(w);
    });
    this.resizeObs.observe(this.host.nativeElement);
  }

  onScrollIndexChange(index: number): void {
    if (!this.hasMore() || this.isLoadingMore()) return;
    const totalRows = this.rows().length;
    // Load more when within 3 rows of the end
    if (index >= totalRows - 3) {
      this.loadMore.emit();
    }
  }

  onScroll(): void {
    // Don't load if already loading or no more items
    if (!this.hasMore() || this.isLoadingMore() || !this.viewport) return;

    // Measure distance from bottom
    const distanceFromBottom = this.viewport.measureScrollOffset('bottom');
    const viewportSize = this.viewport.getViewportSize();

    // Trigger when within 2 viewport heights from bottom
    const threshold = viewportSize * 2;

    if (distanceFromBottom < threshold) {
      this.loadMore.emit();
    }
  }

  ngOnDestroy(): void {
    this.resizeObs?.disconnect();
  }
}
