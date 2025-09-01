import { ChangeDetectionStrategy, Component } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { CacheKey } from '@core/services/cache-key.types';
import { environment } from '@env/environment';
import { injectTrpc } from '@core/services/trpc';
import { ErrorAlert } from '@core/components/error/error';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { AssetThumbnail } from '@core/components/asset-thumbnail/asset-thumbnail';

@Component({
  selector: 'app-gallery-photos',
  imports: [ErrorAlert, HlmSpinner, AssetThumbnail],
  template: `
    @if (files.isPending()) {
      <hlm-spinner />
    }

    @if (files.isError()) {
      <app-error-alert [error]="files.error()" />
    }
    @if (files.isSuccess()) {
      <div class="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
        @for (asset of files.data(); track asset.id) {
          <app-asset-thumbnail [asset]="asset" />
        }
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GalleryPhotos {
  protected readonly apiUrl = environment.api.url;

  private readonly trpc = injectTrpc();

  files = injectQuery(() => ({
    queryKey: [CacheKey.GalleryPhotos],
    queryFn: async () => this.trpc.files.getUsersFiles.query('photo'),
  }));
}
