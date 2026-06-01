import { NgClass } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  MONTH_HEADER_HEIGHT,
  YEAR_HEADER_HEIGHT,
  gridColumnsForWidth,
} from '@core/components/virtual-thumbnail-grid/grid-columns';

// Width of the timeline rail the live grid reserves on md+ (viewport-based).
const TIMELINE_RAIL_PX = 48;
const MD_BREAKPOINT = 768;

// Loading placeholder for a thumbnail grid. It measures its own width and lays
// out with the SAME column count, gap and tile aspect as the live virtual grid
// (and, for the gallery, the same leading year/month header rows and the 48px
// timeline-rail gutter) so when real content arrives it drops into an identical
// layout — zero cumulative layout shift.
@Component({
  selector: 'app-thumbnail-grid-skeleton',
  imports: [NgClass],
  host: { class: 'block h-full overflow-hidden' },
  template: `
    <div class="h-full" [ngClass]="{ 'md:pr-12': headers() }">
      @if (headers()) {
        <div class="flex items-center px-1" [style.height.px]="YEAR_HEADER_HEIGHT">
          <div class="bg-muted h-7 w-28 animate-pulse rounded-md"></div>
        </div>
        <div class="flex items-center px-1" [style.height.px]="MONTH_HEADER_HEIGHT">
          <div class="bg-muted h-4 w-20 animate-pulse rounded"></div>
        </div>
      }

      <div class="grid gap-2" [style.grid-template-columns]="templateColumns()">
        @for (tile of tiles(); track tile) {
          <div class="flex flex-col gap-2">
            <div
              class="bg-muted animate-pulse rounded-lg"
              [style.animation-delay.ms]="(tile % 12) * 30"
              style="aspect-ratio: 1 / 1"
            ></div>
            @if (labelled()) {
              <div class="flex flex-col gap-1 px-1">
                <div class="bg-muted h-3.5 w-3/4 animate-pulse rounded"></div>
                <div class="bg-muted h-3 w-1/3 animate-pulse rounded"></div>
              </div>
            }
          </div>
        }
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThumbnailGridSkeleton implements AfterViewInit, OnDestroy {
  protected readonly YEAR_HEADER_HEIGHT = YEAR_HEADER_HEIGHT;
  protected readonly MONTH_HEADER_HEIGHT = MONTH_HEADER_HEIGHT;

  /** Show leading year/month header placeholders + reserve the timeline rail. */
  readonly headers = input(true);
  /** Render a text label placeholder under each tile (albums/years). */
  readonly labelled = input(false);

  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly ngZone = inject(NgZone);
  private readonly width = signal(0);
  private readonly mdViewport = signal(false);
  private resizeObs?: ResizeObserver;

  // Column count uses the same content width the live grid sees: full host
  // width, minus the timeline-rail gutter on md+ when headers are shown.
  protected readonly columns = computed(() => {
    const reserve = this.headers() && this.mdViewport() ? TIMELINE_RAIL_PX : 0;
    return gridColumnsForWidth(this.width() - reserve);
  });
  protected readonly templateColumns = computed(() => `repeat(${this.columns()}, 1fr)`);

  // Enough rows to comfortably fill any viewport without measuring height.
  protected readonly tiles = computed(() =>
    Array.from({ length: this.columns() * (this.labelled() ? 4 : 8) }, (_, i) => i),
  );

  ngAfterViewInit(): void {
    const el = this.host.nativeElement;
    const measure = (w: number) => {
      if (w <= 0) return;
      const md = typeof window !== 'undefined' && window.innerWidth >= MD_BREAKPOINT;
      if (w !== this.width() || md !== this.mdViewport()) {
        this.ngZone.run(() => {
          this.width.set(w);
          this.mdViewport.set(md);
        });
      }
    };
    this.resizeObs = new ResizeObserver((entries) =>
      measure(entries[0]?.contentRect?.width ?? el.clientWidth),
    );
    this.resizeObs.observe(el);
    measure(el.getBoundingClientRect().width || el.clientWidth);
  }

  ngOnDestroy(): void {
    this.resizeObs?.disconnect();
  }
}
