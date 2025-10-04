import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { AlbumThumbnail } from '@core/components/album-thumbnail/album-thumbnail';
import { AlbumToolbar } from '@core/components/album-toolbar/album-toolbar';
import { AssetThumbnail } from '@core/components/asset-thumbnail/asset-thumbnail';
import { ErrorAlert } from '@core/components/error/error';
import { ThumbnailGrid } from '@core/components/thumbnail-grid/thumbnail-grid';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { injectQuery } from '@tanstack/angular-query-experimental';

@Component({
  selector: 'app-album-detail',
  imports: [HlmSpinner, ErrorAlert, AssetThumbnail, AlbumThumbnail, ThumbnailGrid, AlbumToolbar],
  template: `
    @if (response.isPending()) {
      <hlm-spinner />
    } @else if (response.isError()) {
      <app-error-alert [error]="response.error()" />
    } @else {
      @let data = response.data()!;

      <app-album-toolbar [items]="data.tree.ancestors" />

      @if (data.children.length) {
        <app-thumbnail-grid class="mb-4">
          @for (child of data.children; track child.id) {
            <app-album-thumbnail [album]="child" />
          }
        </app-thumbnail-grid>
      }

      @if (data.files.length) {
        @if (data.children.length !== 0) {
          <p class="mb-4 text-sm">Items</p>
        }

        <app-thumbnail-grid>
          @for (asset of data.files; track asset.id) {
            <app-asset-thumbnail
              [from]="'/albums/' + data.album.id"
              [asset]="asset"
              [albumId]="data.album.id"
            />
          }
        </app-thumbnail-grid>
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlbumDetail {
  private readonly trpc = injectTrpc();
  id = input.required<string>();

  response = injectQuery(() => ({
    queryKey: [CacheKey.AlbumSingle, this.id()],
    queryFn: () => this.trpc.album.getAlbumInfo.query(this.id()),
  }));
}
