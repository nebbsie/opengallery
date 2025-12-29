import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { AssetThumbnail } from '@core/components/asset-thumbnail/asset-thumbnail';
import { ErrorAlert } from '@core/components/error/error';
import { VirtualThumbnailGrid } from '@core/components/virtual-thumbnail-grid/virtual-thumbnail-grid';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { provideIcons } from '@ng-icons/core';
import { lucideCirclePause, lucideCirclePlay } from '@ng-icons/lucide';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { injectInfiniteQuery } from '@tanstack/angular-query-experimental';

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
      <app-virtual-thumbnail-grid
        [items]="allItems()"
        [hasMore]="files.hasNextPage()"
        [isLoadingMore]="files.isFetchingNextPage()"
        (loadMore)="loadMore()"
      >
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

  files = injectInfiniteQuery(() => ({
    queryKey: [CacheKey.GalleryVideos],
    queryFn: async ({ pageParam }) =>
      this.trpc.files.getUsersFiles.query({ kind: 'video', limit: 60, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  }));

  allItems = computed(() => {
    const data = this.files.data();
    if (!data) return [];
    return data.pages.flatMap((page) => page.items);
  });

  loadMore(): void {
    if (this.files.hasNextPage() && !this.files.isFetchingNextPage()) {
      this.files.fetchNextPage();
    }
  }
}
