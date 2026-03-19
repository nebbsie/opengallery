import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import { NgFor, NgTemplateOutlet } from '@angular/common';
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

@Component({
  selector: 'app-virtual-thumbnail-grid',
  standalone: true,
  imports: [ScrollingModule, NgFor, NgTemplateOutlet],
  host: {
    class: 'block h-full',
  },
  styles: `
    :host .cdk-virtual-scroll-viewport {
      overflow-x: hidden;
      scrollbar-width: thin;
      scrollbar-color: hsl(var(--muted-foreground) / 0.3) transparent;
      padding-right: 24px;
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
  private readonly scrollPosition = inject(ScrollPosition);
  private readonly ngZone = inject(NgZone);
  private scrollRestoreState: 'pending' | 'restoring' | 'done' = 'pending';
  private targetScrollPosition: number | null = null;
  private restoreAttempts = 0;
  private readonly MAX_RESTORE_ATTEMPTS = 10;

  items = input<readonly T[] | null>([]);
  minTilePx = input(100); // approximate min tile width
  hasMore = input(false);
  isLoadingMore = input(false);
  scrollKey = input<string | null>(null);
  pageCount = input(0);

  @Output() loadMore = new EventEmitter<void>();

  @ContentChild(TemplateRef) itemTpl!: TemplateRef<{ $implicit: T }>;
  @ViewChild(CdkVirtualScrollViewport) viewport!: CdkVirtualScrollViewport;

  private readonly width = signal(0);
  private resizeObs: ResizeObserver | null = null;

  constructor() {
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
      }
    });
  }

  private checkIfNeedsMoreContent(): void {
    if (!this.hasMore() || this.isLoadingMore() || !this.viewport) return;

    // Use RAF to ensure layout is complete before measuring
    requestAnimationFrame(() => {
      if (!this.viewport) return;

      const viewportHeight = this.viewport.getViewportSize();
      const contentHeight = this.rows().length * this.rowHeight();

      // If content doesn't fill the viewport, load more
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
      // Notify viewport of size change (e.g., when sidebar opens/closes)
      if (this.viewport) {
        this.viewport.checkViewportSize();
      }
    });
    this.resizeObs.observe(this.host.nativeElement);
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
  }
}
