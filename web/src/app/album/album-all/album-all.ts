import { ChangeDetectionStrategy, Component } from '@angular/core';
import { AlbumThumbnail } from '@core/components/album-thumbnail/album-thumbnail';
import { ErrorAlert } from '@core/components/error/error';
import { VirtualThumbnailGrid } from '@core/components/virtual-thumbnail-grid/virtual-thumbnail-grid';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideImages } from '@ng-icons/lucide';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { ThumbnailGridSkeleton } from '@core/components/thumbnail-grid-skeleton/thumbnail-grid-skeleton';
import { injectQuery } from '@tanstack/angular-query-experimental';

@Component({
  selector: 'app-album-all',
  imports: [
    ErrorAlert,
    ThumbnailGridSkeleton,
    HlmIcon,
    NgIcon,
    AlbumThumbnail,
    VirtualThumbnailGrid,
  ],
  providers: [provideIcons({ lucideImages })],
  host: { class: 'flex flex-col h-full' },
  template: `
    @if (response.isPending() && !response.data()) {
      <app-thumbnail-grid-skeleton />
    } @else if (response.isError() && !response.data()) {
      <app-error-alert [error]="response.error()" />
    } @else {
      @if (response.data()!.length === 0) {
        <div class="text-muted-foreground flex flex-col items-center justify-center py-12">
          <ng-icon hlm size="xl" name="lucideImages" class="mb-4" />
          <p>No albums found</p>
          <p class="text-sm">Create an album to organize your photos</p>
        </div>
      } @else {
        <app-virtual-thumbnail-grid
          class="min-h-0 flex-1"
          [items]="response.data() ?? []"
          [rowHeightExtra]="48"
        >
          <ng-template let-album>
            <app-album-thumbnail [album]="album" />
          </ng-template>
        </app-virtual-thumbnail-grid>
      }
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
