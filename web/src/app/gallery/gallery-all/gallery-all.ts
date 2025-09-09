import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ErrorAlert } from '@core/components/error/error';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { environment } from '@env/environment';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { lucideCirclePlay, lucideCirclePause } from '@ng-icons/lucide';
import { NgOptimizedImage } from '@angular/common';
import { AssetThumbnail } from '@core/components/asset-thumbnail/asset-thumbnail';

@Component({
  selector: 'app-gallery-all',
  providers: [
    provideIcons({
      lucideCirclePlay,
      lucideCirclePause,
    }),
  ],
  imports: [HlmSpinner, ErrorAlert, AssetThumbnail],
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
export class GalleryAll {
  private readonly trpc = injectTrpc();

  files = injectQuery(() => ({
    queryKey: [CacheKey.GalleryAll],
    queryFn: async () => this.trpc.files.getUsersFiles.query('all'),
  }));
}
