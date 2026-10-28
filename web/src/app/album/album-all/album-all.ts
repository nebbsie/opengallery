import { ChangeDetectionStrategy, Component, computed, effect, signal } from '@angular/core';
import { AlbumThumbnail } from '@core/components/album-thumbnail/album-thumbnail';
import { ErrorAlert } from '@core/components/error/error';
import { VirtualThumbnailGrid } from '@core/components/virtual-thumbnail-grid/virtual-thumbnail-grid';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideImages } from '@ng-icons/lucide';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { injectQuery } from '@tanstack/angular-query-experimental';

type AlbumSort = 'name' | 'added' | 'taken' | 'count' | 'size';

type SortableAlbum = {
  name: string;
  items: number;
  size?: number;
  lastAddedAt?: string | null;
  lastTakenAt?: string | null;
};

const SORT_KEY = 'og.albums.sort';
const SORTS: { id: AlbumSort; label: string }[] = [
  { id: 'added', label: 'Recently added' },
  { id: 'name', label: 'Name' },
  { id: 'taken', label: 'Date taken' },
  { id: 'count', label: 'Most photos' },
  { id: 'size', label: 'Size' },
];

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

// Newest first; albums with no date go last.
function byDateDesc(a: string | null | undefined, b: string | null | undefined): number {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a < b ? 1 : -1;
}

function readSort(): AlbumSort {
  try {
    const v = localStorage.getItem(SORT_KEY);
    if (SORTS.some((s) => s.id === v)) return v as AlbumSort;
  } catch {}
  return 'added';
}

@Component({
  selector: 'app-album-all',
  imports: [ErrorAlert, HlmIcon, NgIcon, AlbumThumbnail, VirtualThumbnailGrid],
  providers: [provideIcons({ lucideImages })],
  host: { class: 'flex flex-col h-full' },
  template: `
    @if (response.isPending() && !response.data()) {
      <div
        class="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-2 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] lg:grid-cols-[repeat(auto-fill,minmax(200px,1fr))]"
        aria-busy="true"
        aria-label="Loading albums"
      >
        @for (i of skeleton; track i) {
          <div class="flex flex-col gap-1">
            <div class="bg-muted aspect-square w-full animate-pulse rounded-lg"></div>
            <div class="flex flex-col gap-1.5 px-2 pt-1">
              <div class="bg-muted h-3.5 w-3/4 animate-pulse rounded"></div>
              <div class="bg-muted h-3 w-1/3 animate-pulse rounded"></div>
            </div>
          </div>
        }
      </div>
    } @else if (response.isError() && !response.data()) {
      <app-error-alert [error]="response.error()" />
    } @else {
      @if (response.data()!.length === 0) {
        <div class="text-muted-foreground flex flex-col items-center justify-center py-12">
          <ng-icon hlm size="xl" name="lucideImages" class="mb-4" />
          <p class="text-foreground font-medium">No albums yet</p>
        </div>
      } @else {
        <!-- Scrolls sideways on a narrow phone instead of wrapping. -->
        <div
          role="radiogroup"
          aria-label="Sort albums"
          class="-mx-1 mb-3 flex shrink-0 gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]"
        >
          @for (s of sorts; track s.id) {
            <button
              type="button"
              role="radio"
              [attr.aria-checked]="sort() === s.id"
              class="focus-visible:ring-ring min-h-11 shrink-0 rounded-full border px-4 text-sm font-medium whitespace-nowrap outline-none transition-[background-color,color,border-color] duration-150 focus-visible:ring-2 active:scale-[0.96] sm:min-h-8"
              [class]="
                sort() === s.id
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'text-foreground hover:bg-accent'
              "
              (click)="sort.set(s.id)"
            >
              {{ s.label }}
            </button>
          }
        </div>
        <app-virtual-thumbnail-grid
          class="min-h-0 flex-1"
          [items]="sorted()"
          [rowHeightExtra]="48"
          [dateHeaders]="false"
        >
          <ng-template let-album>
            <app-album-thumbnail [album]="album" />
          </ng-template>
        </app-virtual-thumbnail-grid>
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlbumAll {
  private readonly trpc = injectTrpc();

  response = injectQuery(() => ({
    queryKey: [CacheKey.AlbumsAll],
    queryFn: async () => this.trpc.album.getUsersAlbums.query(),
    // Poll only while some album still has photos being processed, so the
    // import badges update. When all work is done, the list stops polling.
    refetchInterval: (query: { state: { data?: unknown } }) =>
      (query.state.data as Array<{ pendingTasks?: number }> | undefined)?.some(
        (a) => (a.pendingTasks ?? 0) > 0,
      )
        ? 5000
        : false,
  }));

  protected readonly sorts = SORTS;
  // Per viewer, remembered in this browser.
  protected readonly sort = signal<AlbumSort>(readSort());

  protected readonly sorted = computed(() => {
    const albums = [...(this.response.data() ?? [])] as (SortableAlbum & object)[];
    const sort = this.sort();
    const name = (a: SortableAlbum, b: SortableAlbum) => byName.compare(a.name, b.name);
    const cmp: Record<AlbumSort, (a: SortableAlbum, b: SortableAlbum) => number> = {
      name,
      added: (a, b) => byDateDesc(a.lastAddedAt, b.lastAddedAt) || name(a, b),
      taken: (a, b) => byDateDesc(a.lastTakenAt, b.lastTakenAt) || name(a, b),
      count: (a, b) => b.items - a.items || name(a, b),
      size: (a, b) => (b.size ?? 0) - (a.size ?? 0) || name(a, b),
    };
    return albums.sort(cmp[sort]);
  });

  constructor() {
    effect(() => {
      const v = this.sort();
      try {
        localStorage.setItem(SORT_KEY, v);
      } catch {}
    });
  }

  protected readonly skeleton = Array.from({ length: 12 }, (_, i) => i);
}
