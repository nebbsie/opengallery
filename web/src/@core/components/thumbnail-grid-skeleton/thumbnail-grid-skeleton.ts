import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

// A placeholder grid shown while a thumbnail grid is loading. It mirrors the
// virtual grid's column breakpoints (minmax 100/160/200) so the real content
// drops into the same layout with no visible shift, replacing the old
// centered spinner.
@Component({
  selector: 'app-thumbnail-grid-skeleton',
  host: { class: 'block h-full overflow-hidden' },
  template: `
    <div
      class="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(100px,1fr))] sm:[grid-template-columns:repeat(auto-fill,minmax(160px,1fr))] lg:[grid-template-columns:repeat(auto-fill,minmax(200px,1fr))]"
    >
      @for (tile of tiles(); track tile) {
        <div class="bg-muted aspect-square animate-pulse rounded-lg"></div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThumbnailGridSkeleton {
  /** How many placeholder tiles to render. */
  readonly count = input(24);
  protected readonly tiles = computed(() => Array.from({ length: this.count() }));
}
