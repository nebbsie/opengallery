import { ChangeDetectionStrategy, Component } from '@angular/core';
import { AssetThumbnail } from '@core/components/asset-thumbnail/asset-thumbnail';
import { ErrorAlert } from '@core/components/error/error';
import { VirtualThumbnailGrid } from '@core/components/virtual-thumbnail-grid/virtual-thumbnail-grid';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { provideIcons } from '@ng-icons/core';
import { lucideCirclePause, lucideCirclePlay } from '@ng-icons/lucide';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { injectQuery } from '@tanstack/angular-query-experimental';

@Component({
  selector: 'app-gallery-videos',
  providers: [
    provideIcons({
      lucideCirclePlay,
      lucideCirclePause,
    }),
  ],
  imports: [ErrorAlert, HlmSpinner, AssetThumbnail, VirtualThumbnailGrid],
  template: `
    @if (files.isPending()) {
      <hlm-spinner />
    }

    @if (files.isError()) {
      <app-error-alert [error]="files.error()" />
    }

    @if (files.isSuccess()) {
      <app-virtual-thumbnail-grid [items]="files.data()">
        <ng-template let-asset>
          <app-asset-thumbnail from="/gallery/videos" [asset]="asset" />
        </ng-template>
      </app-virtual-thumbnail-grid>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GalleryVideos {
  private readonly trpc = injectTrpc();

  files = injectQuery(() => ({
    queryKey: [CacheKey.GalleryVideos],
    queryFn: async () => this.trpc.files.getUsersFiles.query('video'),
  }));
}
