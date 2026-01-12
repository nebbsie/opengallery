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
  host: { class: 'flex flex-col h-full' },
  template: `
    @if (response.isPending() && !response.data()) {
      <hlm-spinner />
    } @else if (response.isError() && !response.data()) {
      <app-error-alert [error]="response.error()" />
    } @else {
      <app-album-toolbar [items]="[]" />

      <app-virtual-thumbnail-grid class="min-h-0 flex-1" [items]="response.data() ?? []">
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
    refetchInterval: 5000, // Refresh to update importing status
  }));
}
