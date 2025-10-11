import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AssetThumbnail } from '@core/components/asset-thumbnail/asset-thumbnail';
import { ErrorAlert } from '@core/components/error/error';
import { VirtualThumbnailGrid } from '@core/components/virtual-thumbnail-grid/virtual-thumbnail-grid';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { provideIcons } from '@ng-icons/core';
import { lucideCirclePause, lucideCirclePlay } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { injectQuery } from '@tanstack/angular-query-experimental';

@Component({
  selector: 'app-gallery-all',
  providers: [
    provideIcons({
      lucideCirclePlay,
      lucideCirclePause,
    }),
  ],
  imports: [HlmSpinner, ErrorAlert, AssetThumbnail, RouterLink, HlmButton, VirtualThumbnailGrid],
  template: `
    @if (files.isPending()) {
      <hlm-spinner />
    }

    @if (files.isError()) {
      <app-error-alert [error]="files.error()" />
    }

    @if (files.isSuccess()) {
      @if (!files.data().length) {
        <div class="flex flex-col items-center justify-center gap-3 py-10 text-center">
          <p class="text-muted-foreground text-sm">
            No assets yet. Add a new source folder to import your library.
          </p>
          <a hlmBtn routerLink="/settings/sources">Go to Source Folders</a>
        </div>
      } @else {
        <app-virtual-thumbnail-grid [items]="files.data()">
          <ng-template let-asset>
            <app-asset-thumbnail from="/" [asset]="asset" />
          </ng-template>
        </app-virtual-thumbnail-grid>
      }
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
