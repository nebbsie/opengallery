import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { AssetThumbnail } from '@core/components/asset-thumbnail/asset-thumbnail';
import { BackOnEscapeDirective } from '@core/directives/back-on-escape/back-on-escape.directive';
import { ErrorAlert } from '@core/components/error/error';
import { GridSkeleton } from '@core/components/loading-thumbnail/grid-skeleton';
import { SelectionBar } from '@core/components/selection-bar/selection-bar';
import { VirtualThumbnailGrid } from '@core/components/virtual-thumbnail-grid/virtual-thumbnail-grid';
import { CacheKey } from '@core/services/cache-key.types';
import { GridSelection } from '@core/services/selection/grid-selection';
import { injectTrpc } from '@core/services/trpc';
import { injectInfiniteQuery } from '@tanstack/angular-query-experimental';

@Component({
  selector: 'app-camera-detail',
  imports: [ErrorAlert, GridSkeleton, SelectionBar, AssetThumbnail, VirtualThumbnailGrid],
  providers: [GridSelection],
  hostDirectives: [BackOnEscapeDirective],
  host: { class: 'flex flex-col h-full min-h-0' },
  template: `
    <h1 class="text-foreground mb-2 flex shrink-0 items-center gap-2 text-2xl font-bold capitalize text-balance">
      {{ make() }} <span class="text-muted-foreground text-sm">{{ model() }}</span>
    </h1>

    @if (files.isPending() && !files.data()) {
      <app-grid-skeleton class="min-h-0 flex-1" />
    } @else if (files.isError() && !files.data()) {
      <app-error-alert [error]="files.error()" />
    } @else if (allItems().length === 0) {
      <p class="text-muted-foreground text-sm">No photos found.</p>
    } @else {
      <app-virtual-thumbnail-grid
        class="min-h-0 flex-1"
        [items]="allItems()"
        [hasMore]="files.hasNextPage()"
        [isLoadingMore]="files.isFetchingNextPage()"
        [scrollKey]="scrollKey()"
        [dateAccessor]="dateAccessor"
        (loadMore)="loadMore()"
      >
        <ng-template let-asset>
          <app-asset-thumbnail
            [from]="fromPath()"
            [asset]="asset"
            [cameraMake]="make()"
            [cameraModel]="model()"
          />
        </ng-template>
      </app-virtual-thumbnail-grid>
      <app-selection-bar />
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CameraDetail {
  make = input.required<string>();
  model = input.required<string>();

  private readonly trpc = injectTrpc();

  fromPath = computed(() => `/cameras/${this.make()}/${this.model()}`);
  scrollKey = computed(() => `camera-${this.make()}-${this.model()}`);

  protected readonly dateAccessor = (item: {
    takenAt?: Date | string | null;
    createdAt?: Date | string | null;
  }) => item.takenAt ?? item.createdAt ?? null;

  files = injectInfiniteQuery(() => ({
    queryKey: [CacheKey.CameraSingle, this.make(), this.model()],
    queryFn: async ({ pageParam }) =>
      this.trpc.camera.getFilesByCamera.query({
        make: this.make(),
        model: this.model(),
        limit: 200,
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
