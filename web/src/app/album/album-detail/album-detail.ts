import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { AlbumThumbnail } from '@core/components/album-thumbnail/album-thumbnail';
import { AlbumToolbar } from '@core/components/album-toolbar/album-toolbar';
import { AssetThumbnail } from '@core/components/asset-thumbnail/asset-thumbnail';
import { ErrorAlert } from '@core/components/error/error';
import { LoadingThumbnail } from '@core/components/loading-thumbnail/loading-thumbnail';
import { ThumbnailGrid } from '@core/components/thumbnail-grid/thumbnail-grid';
import { ShareItem } from '@core/dialogs/share-item/share-item';
import { BackOnEscapeDirective } from '@core/directives/back-on-escape/back-on-escape.directive';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideShare2 } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { GridSkeleton } from '@core/components/loading-thumbnail/grid-skeleton';
import { SelectionBar } from '@core/components/selection-bar/selection-bar';
import { VirtualThumbnailGrid } from '@core/components/virtual-thumbnail-grid/virtual-thumbnail-grid';
import { GridSelection } from '@core/services/selection/grid-selection';
import { injectQuery } from '@tanstack/angular-query-experimental';
import type { RouterOutputs } from '@core/services/trpc';

@Component({
  selector: 'app-album-detail',
  imports: [
    GridSkeleton,
    SelectionBar,
    VirtualThumbnailGrid,
    ErrorAlert,
    AssetThumbnail,
    AlbumThumbnail,
    ThumbnailGrid,
    AlbumToolbar,
    LoadingThumbnail,
    HlmButton,
    HlmIcon,
    NgIcon,
  ],
  providers: [GridSelection, provideIcons({ lucideShare2 })],
  hostDirectives: [BackOnEscapeDirective],
  host: { class: 'flex h-full min-h-0 flex-col' },
  template: `
    @if (response.isPending() && !response.data()) {
      <app-grid-skeleton class="min-h-0 flex-1" [headers]="false" />
    } @else if (response.isError() && !response.data()) {
      <app-error-alert [error]="response.error() ?? undefined" />
    } @else {
      @let data = response.data()!;

      <div class="mb-2 flex items-center justify-between gap-3">
        <app-album-toolbar [items]="data.tree.ancestors" />

        @if (data.album.canManageShares) {
          <button
            hlmBtn
            variant="outline"
            type="button"
            class="transition-transform active:scale-[0.96]"
            (click)="openShareDialog(data.album.id, data.album.name)"
          >
            <ng-icon hlm size="sm" name="lucideShare2" />
            Share
          </button>
        }
      </div>

      @if (allItems().length === 0 && data.children.length === 0) {
        <p class="text-muted-foreground py-12 text-center text-sm">This album is empty.</p>
      } @else if (allItems().length === 0) {
        <!-- Only sub-albums: a plain wrapping grid that scrolls with the page. -->
        <div class="min-h-0 flex-1 overflow-y-auto">
          <app-thumbnail-grid>
            @for (child of data.children; track child.id) {
              <app-album-thumbnail [album]="child" />
            }
          </app-thumbnail-grid>
        </div>
      } @else {
        @if (data.children.length) {
          <!-- Sub-albums sit in a strip so the photos below can use the
               virtual grid (which owns its own scroll). -->
          <div class="-mx-1 mb-3 flex shrink-0 snap-x gap-2 overflow-x-auto px-1 pb-1">
            @for (child of data.children; track child.id) {
              <app-album-thumbnail class="w-36 shrink-0 snap-start sm:w-44" [album]="child" />
            }
          </div>
        }

        <app-virtual-thumbnail-grid
          class="min-h-0 flex-1"
          [items]="allItems()"
          [scrollKey]="'album-' + data.album.id"
          [dateAccessor]="dateAccessor"
          [dayHeaders]="false"
        >
          <ng-template let-item>
            @if (item.loading) {
              <app-loading-thumbnail />
            } @else {
              <app-asset-thumbnail
                [from]="'/albums/' + data.album.id"
                [asset]="item"
                [albumId]="data.album.id"
              />
            }
          </ng-template>
        </app-virtual-thumbnail-grid>
        <app-selection-bar />
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlbumDetail {
  private readonly trpc = injectTrpc();
  private readonly dialog = inject(HlmDialogService);
  id = input.required<string>();

  response = injectQuery(() => ({
    queryKey: [CacheKey.AlbumSingle, this.id()],
    queryFn: () => this.trpc.album.getAlbumInfo.query(this.id()),
    // Only poll while an import is in flight; a settled album is static, so
    // there's nothing to refresh. This stops the album view from re-running
    // the (expensive) full-file-list query 720×/hour when nothing is importing.
    refetchInterval: (query: { state: { data?: RouterOutputs['album']['getAlbumInfo'] } }) =>
      (query.state.data?.album?.pendingTasks ?? 0) > 0 ? 5000 : false,
    staleTime: 5000,
  }));

  protected readonly dateAccessor = (item: { takenAt?: string | null; loading?: boolean }) =>
    item.loading ? null : (item.takenAt ?? null);

  allItems = computed(() => {
    const data = this.response.data();
    if (!data) return [];

    const files = data.files.map(
      (f: { type: 'image' | 'video'; id: string; blurhash?: string | null }) => ({
        ...f,
        loading: false,
      }),
    );
    const pendingCount = data.album.pendingTasks ?? 0;

    // Add placeholder items for pending files
    const placeholders = Array.from({ length: pendingCount }, (_, i) => ({
      id: `loading-${i}`,
      type: 'image' as const,
      loading: true,
    }));

    return [...files, ...placeholders];
  });

  openShareDialog(albumId: string, albumName: string) {
    this.dialog.open(ShareItem, {
      context: {
        sourceType: 'album',
        sourceId: albumId,
        title: albumName,
      },
    });
  }
}
