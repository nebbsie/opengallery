import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { AssetThumbnail } from '@core/components/asset-thumbnail/asset-thumbnail';
import { ErrorAlert } from '@core/components/error/error';
import { VirtualThumbnailGrid } from '@core/components/virtual-thumbnail-grid/virtual-thumbnail-grid';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { injectInfiniteQuery } from '@tanstack/angular-query-experimental';

@Component({
  selector: 'app-camera-detail',
  imports: [ErrorAlert, HlmSpinner, AssetThumbnail, VirtualThumbnailGrid],
  template: `
    @if (files.isPending()) {
      <hlm-spinner />
    }

    @if (files.isError()) {
      <app-error-alert [error]="files.error()" />
    }

    @if (files.isSuccess()) {
      <div class="mb-6">
        <h1 class="text-foreground mb-2 text-2xl font-bold">{{ make() }}</h1>
        <p class="text-muted-foreground text-sm">{{ model() }}</p>
      </div>

      <app-virtual-thumbnail-grid
        [items]="allItems()"
        [hasMore]="files.hasNextPage()"
        [isLoadingMore]="files.isFetchingNextPage()"
        (loadMore)="loadMore()"
      >
        <ng-template let-asset>
          <app-asset-thumbnail [from]="fromPath()" [asset]="asset" />
        </ng-template>
      </app-virtual-thumbnail-grid>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CameraDetail {
  make = input.required<string>();
  model = input.required<string>();

  private readonly trpc = injectTrpc();

  fromPath = computed(() => `/cameras/${this.make()}/${this.model()}`);

  files = injectInfiniteQuery(() => ({
    queryKey: [CacheKey.CameraSingle, this.make(), this.model()],
    queryFn: async ({ pageParam }) =>
      this.trpc.camera.getFilesByCamera.query({
        make: this.make(),
        model: this.model(),
        limit: 60,
        cursor: pageParam,
      }),
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
