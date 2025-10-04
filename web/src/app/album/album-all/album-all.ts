import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ErrorAlert } from '@core/components/error/error';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { AlbumThumbnail } from '@core/components/album-thumbnail/album-thumbnail';
import { ThumbnailGrid } from '@core/components/thumbnail-grid/thumbnail-grid';
import { AlbumToolbar } from '@core/components/album-toolbar/album-toolbar';

@Component({
  selector: 'app-album-all',
  imports: [ErrorAlert, HlmSpinner, AlbumThumbnail, ThumbnailGrid, AlbumToolbar],
  template: `
    @if (response.isPending()) {
      <hlm-spinner />
    }

    @if (response.isError() && response.error(); as error) {
      <app-error-alert [error]="error" />
    }

    @if (response.isSuccess()) {
      <app-album-toolbar [items]="[]" />

      <app-thumbnail-grid>
        @for (album of response.data(); track album.id) {
          <app-album-thumbnail [album]="album" />
        }
      </app-thumbnail-grid>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlbumAll {
  private readonly trpc = injectTrpc();

  response = injectQuery(() => ({
    queryKey: [CacheKey.AlbumsAll],
    queryFn: async () => this.trpc.album.getUsersAlbums.query(),
  }));
}
