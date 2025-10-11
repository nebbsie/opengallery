import { ScrollingModule } from '@angular/cdk/scrolling';
import { NgFor, NgTemplateOutlet } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ContentChild,
  ElementRef,
  Input,
  OnDestroy,
  TemplateRef,
  computed,
  inject,
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

  @Input() items: readonly T[] | null = [];
  @Input() minTilePx = 200; // approximate min tile width

  @ContentChild(TemplateRef) itemTpl!: TemplateRef<{ $implicit: T }>;

  private readonly width = signal(0);
  private resizeObs: ResizeObserver | null = null;

  columns = computed(() => {
    const w = this.width();
    const min = Math.max(120, this.minTilePx);
    const cols = Math.max(1, Math.floor(w / min));
    return cols;
  });

  gridTemplateColumns = computed(
    () => `repeat(${this.columns()}, minmax(${this.minTilePx}px, 1fr))`,
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
    const items = (this.items ?? []) as readonly T[];
    const cols = this.columns();
    if (!items.length) return [] as T[][];
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += cols) out.push(items.slice(i, i + cols));
    return out;
  });

  trackRow = (_: number, row: readonly T[]) => (row.length ? row[0] : _);

  templateCtx(item: T): { $implicit: T } {
    return { $implicit: item } as { $implicit: T };
  }

  ngAfterViewInit(): void {
    this.resizeObs = new ResizeObserver((entries: ResizeObserverEntry[]) => {
      const entry = entries[0];
      const cr = entry?.contentRect as DOMRect | undefined;
      const w = cr?.width ?? this.host.nativeElement.clientWidth;
      this.width.set(w);
    });
    this.resizeObs.observe(this.host.nativeElement);
  }

  ngOnDestroy(): void {
    this.resizeObs?.disconnect();
  }
}
