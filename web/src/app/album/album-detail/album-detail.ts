import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { AlbumThumbnail } from '@core/components/album-thumbnail/album-thumbnail';
import { AlbumToolbar } from '@core/components/album-toolbar/album-toolbar';
import { AssetThumbnail } from '@core/components/asset-thumbnail/asset-thumbnail';
import { ErrorAlert } from '@core/components/error/error';
import { LoadingThumbnail } from '@core/components/loading-thumbnail/loading-thumbnail';
import { ThumbnailGrid } from '@core/components/thumbnail-grid/thumbnail-grid';
import { VirtualThumbnailGrid } from '@core/components/virtual-thumbnail-grid/virtual-thumbnail-grid';
import { ShareItem } from '@core/dialogs/share-item/share-item';
import { BackOnEscapeDirective } from '@core/directives/back-on-escape/back-on-escape.directive';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideShare2 } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { Loading } from '@core/components/loading/loading';
import { injectQuery } from '@tanstack/angular-query-experimental';

@Component({
  selector: 'app-album-detail',
  imports: [
    Loading,
    ErrorAlert,
    AssetThumbnail,
    AlbumThumbnail,
    ThumbnailGrid,
    AlbumToolbar,
    VirtualThumbnailGrid,
    LoadingThumbnail,
    HlmButton,
    HlmIcon,
    NgIcon,
  ],
  providers: [provideIcons({ lucideShare2 })],
  hostDirectives: [BackOnEscapeDirective],
  host: { class: 'flex flex-col h-full' },
  template: `
    @if (response.isPending() && !response.data()) {
      <app-loading />
    } @else if (response.isError() && !response.data()) {
      <app-error-alert [error]="response.error()" />
    } @else {
      @let data = response.data()!;

      <div class="mb-2 flex items-center justify-between gap-3">
        <app-album-toolbar [items]="data.tree.ancestors" />

        @if (data.album.canManageShares) {
          <button
            hlmBtn
            variant="outline"
            type="button"
            (click)="openShareDialog(data.album.id, data.album.name)"
          >
            <ng-icon hlm size="sm" name="lucideShare2" />
            Share
          </button>
        }
      </div>

      @if (data.children.length) {
        <app-thumbnail-grid class="mb-4">
          @for (child of data.children; track child.id) {
            <app-album-thumbnail [album]="child" />
          }
        </app-thumbnail-grid>
      }

      @if (data.files.length || data.album.pendingTasks) {
        @if (data.children.length !== 0) {
          <p class="mb-4 text-sm">Items</p>
        }

        <app-virtual-thumbnail-grid class="min-h-0 flex-1" [items]="allItems()">
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
    refetchInterval: (query: { state: { data?: { album: { pendingTasks: number } } } }) =>
      (query.state.data?.album.pendingTasks ?? 0) > 0 ? 5000 : false,
    staleTime: 5000,
  }));

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
