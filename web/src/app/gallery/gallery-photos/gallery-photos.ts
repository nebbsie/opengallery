import { ChangeDetectionStrategy, Component } from '@angular/core';
import { AssetThumbnail } from '@core/components/asset-thumbnail/asset-thumbnail';
import { ErrorAlert } from '@core/components/error/error';
import { VirtualThumbnailGrid } from '@core/components/virtual-thumbnail-grid/virtual-thumbnail-grid';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { injectQuery } from '@tanstack/angular-query-experimental';

@Component({
  selector: 'app-gallery-photos',
  imports: [ErrorAlert, HlmSpinner, AssetThumbnail, VirtualThumbnailGrid],
  template: `
    @if (files.isPending()) {
      <hlm-spinner />
    }

    @if (files.isError()) {
      <app-error-alert [error]="files.error()" />
    }

    @if (files.isSuccess()) {
      @let payload = files.data();
      <app-virtual-thumbnail-grid [items]="payload.items">
        <ng-template let-asset>
          <app-asset-thumbnail from="/gallery/photos" [asset]="asset" />
        </ng-template>
      </app-virtual-thumbnail-grid>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GalleryPhotos {
  private readonly trpc = injectTrpc();

  files = injectQuery(() => ({
    queryKey: [CacheKey.GalleryPhotos],
    queryFn: async () => this.trpc.files.getUsersFiles.query({ kind: 'image', limit: 120 }),
  }));
}
