import { ChangeDetectionStrategy, Component } from '@angular/core';
import { injectTrpc } from '@core/services/trpc';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { CacheKey } from '@core/services/cache-key.types';
import { ErrorAlert } from '@core/components/error/error';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { provideIcons } from '@ng-icons/core';
import { lucideCirclePause, lucideCirclePlay } from '@ng-icons/lucide';
import { AssetThumbnail } from '@core/components/asset-thumbnail/asset-thumbnail';
import { ThumbnailGrid } from '@core/components/thumbnail-grid/thumbnail-grid';

@Component({
  selector: 'app-gallery-videos',
  providers: [
    provideIcons({
      lucideCirclePlay,
      lucideCirclePause,
    }),
  ],
  imports: [ErrorAlert, HlmSpinner, AssetThumbnail, ThumbnailGrid],
  template: `
    @if (files.isPending()) {
      <hlm-spinner />
    }

    @if (files.isError()) {
      <app-error-alert [error]="files.error()" />
    }

    @if (files.isSuccess()) {
      <app-thumbnail-grid>
        @for (asset of files.data(); track asset.id) {
          <app-asset-thumbnail [asset]="asset" />
        }
      </app-thumbnail-grid>
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
