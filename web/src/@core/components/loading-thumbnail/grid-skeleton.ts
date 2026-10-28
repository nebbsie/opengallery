import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  DAY_HEADER_HEIGHT,
  MONTH_HEADER_HEIGHT,
  SQUARE_GAP,
  YEAR_HEADER_HEIGHT,
  squareColumns,
  squareTileSize,
} from '@core/components/virtual-thumbnail-grid/grid-layout';

/**
 * First-load placeholder for a photo grid. Uses the same column maths and
 * header heights as `app-virtual-thumbnail-grid`, so the real tiles land in
 * the same place when the data arrives (no layout shift).
 */
@Component({
  selector: 'app-grid-skeleton',
  host: {
    class: 'block h-full overflow-hidden',
    'aria-busy': 'true',
    'aria-label': 'Loading photos',
    role: 'status',
    '[class.md:pr-12]': 'rail()',
  },
  template: `
    @if (width() > 0) {
      @if (headers()) {
        <div class="flex items-center px-1" [style.height.px]="YEAR_HEADER_HEIGHT">
          <div class="bg-muted h-7 w-20 animate-pulse rounded-md"></div>
        </div>
        <div class="flex items-end px-1 pb-2" [style.height.px]="MONTH_HEADER_HEIGHT">
          <div class="bg-muted h-4 w-32 animate-pulse rounded"></div>
        </div>
        <div class="flex items-end px-1 pb-2" [style.height.px]="DAY_HEADER_HEIGHT">
          <div class="bg-muted h-3.5 w-24 animate-pulse rounded"></div>
        </div>
      }
      @for (r of rows(); track $index) {
        <div
          class="grid"
          [style.gap.px]="SQUARE_GAP"
          [style.margin-bottom.px]="SQUARE_GAP"
          [style.grid-template-columns]="'repeat(' + columns() + ', 1fr)'"
        >
          @for (c of cells(); track $index) {
            <div
              class="bg-muted animate-pulse rounded-lg"
              [style.height.px]="tile()"
              [style.animation-delay.ms]="($index + r) * 40"
            ></div>
          }
        </div>
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GridSkeleton implements AfterViewInit, OnDestroy {
  private readonly el = inject(ElementRef<HTMLElement>);
  /** Show year/month/day header placeholders (timeline grids). */
  headers = input(true);
  /** Leave room for the desktop timeline rail (48px), as the grid does. */
  rail = input(false);

  protected readonly YEAR_HEADER_HEIGHT = YEAR_HEADER_HEIGHT;
  protected readonly MONTH_HEADER_HEIGHT = MONTH_HEADER_HEIGHT;
  protected readonly DAY_HEADER_HEIGHT = DAY_HEADER_HEIGHT;
  protected readonly SQUARE_GAP = SQUARE_GAP;

  protected readonly width = signal(0);
  private readonly height = signal(0);
  private obs: ResizeObserver | null = null;

  protected readonly columns = computed(() => squareColumns(this.width()));
  protected readonly tile = computed(() => squareTileSize(this.width()));
  protected readonly cells = computed(() => Array.from({ length: this.columns() }, (_, i) => i));
  protected readonly rows = computed(() => {
    const n = Math.max(2, Math.ceil(this.height() / (this.tile() + SQUARE_GAP)));
    return Array.from({ length: Math.min(n, 12) }, (_, i) => i);
  });

  ngAfterViewInit(): void {
    if (typeof ResizeObserver === 'undefined') return;
    const node = this.el.nativeElement as HTMLElement;
    const apply = (w: number, h: number) => {
      if (w > 0) this.width.set(w);
      if (h > 0) this.height.set(h);
    };
    const rect = node.getBoundingClientRect();
    apply(rect.width, rect.height || window.innerHeight);
    this.obs = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) apply(r.width, r.height || window.innerHeight);
    });
    this.obs.observe(node);
  }

  ngOnDestroy(): void {
    this.obs?.disconnect();
  }
}
