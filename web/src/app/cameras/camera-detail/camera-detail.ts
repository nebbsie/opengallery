import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { AssetThumbnail } from '@core/components/asset-thumbnail/asset-thumbnail';
import { BackOnEscapeDirective } from '@core/directives/back-on-escape/back-on-escape.directive';
import { ErrorAlert } from '@core/components/error/error';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { Loading } from '@core/components/loading/loading';
import { injectInfiniteQuery } from '@tanstack/angular-query-experimental';

@Component({
  selector: 'app-camera-detail',
  imports: [ErrorAlert, Loading, AssetThumbnail],
  hostDirectives: [BackOnEscapeDirective],
  host: { class: 'block overflow-y-auto min-h-0 flex-1' },
  template: `
    @if (files.isPending() && !files.data()) {
      <app-loading />
    } @else if (files.isError() && !files.data()) {
      <app-error-alert [error]="files.error()" />
    } @else {
      <h1 class="text-foreground mb-2 flex items-center gap-2 text-2xl font-bold capitalize">
        {{ make() }} <span class="text-muted-foreground text-sm">{{ model() }}</span>
      </h1>

      <div class="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-2 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))]">
        @for (asset of allItems(); track asset.id) {
          <app-asset-thumbnail
            [from]="fromPath()"
            [asset]="asset"
            [cameraMake]="make()"
            [cameraModel]="model()"
          />
        }
      </div>

      @if (files.hasNextPage()) {
        <div class="mt-6 flex justify-center">
          <button
            (click)="loadMore()"
            [disabled]="files.isFetchingNextPage()"
            class="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-6 py-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            @if (files.isFetchingNextPage()) { Loading... } @else { Load More }
          </button>
        </div>
      }
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
