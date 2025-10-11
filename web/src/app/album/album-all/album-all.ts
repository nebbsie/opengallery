import { ChangeDetectionStrategy, Component } from '@angular/core';
import { AlbumThumbnail } from '@core/components/album-thumbnail/album-thumbnail';
import { AlbumToolbar } from '@core/components/album-toolbar/album-toolbar';
import { ErrorAlert } from '@core/components/error/error';
import { VirtualThumbnailGrid } from '@core/components/virtual-thumbnail-grid/virtual-thumbnail-grid';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { injectQuery } from '@tanstack/angular-query-experimental';

@Component({
  selector: 'app-album-all',
  imports: [ErrorAlert, HlmSpinner, AlbumThumbnail, AlbumToolbar, VirtualThumbnailGrid],
  template: `
    @if (response.isPending()) {
      <hlm-spinner />
    }

    @if (response.isError() && response.error(); as error) {
      <app-error-alert [error]="error" />
    }

    @if (response.isSuccess()) {
      <app-album-toolbar [items]="[]" />

      <app-virtual-thumbnail-grid [items]="response.data()">
        <ng-template let-album>
          <app-album-thumbnail [album]="album" />
        </ng-template>
      </app-virtual-thumbnail-grid>
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
