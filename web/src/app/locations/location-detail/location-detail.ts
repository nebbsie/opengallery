import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AssetThumbnail } from '@core/components/asset-thumbnail/asset-thumbnail';
import { ErrorAlert } from '@core/components/error/error';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { injectInfiniteQuery } from '@tanstack/angular-query-experimental';

@Component({
  selector: 'app-location-detail',
  imports: [ErrorAlert, HlmSpinner, AssetThumbnail, RouterLink],
  host: { class: 'flex flex-col h-full' },
  template: `
    @if (files.isPending() && !files.data()) {
      <hlm-spinner />
    } @else if (files.isError() && !files.data()) {
      <app-error-alert [error]="files.error()" />
    } @else {
      <div class="mb-6 shrink-0">
        <h1 class="text-foreground mb-2 text-2xl font-bold">Location</h1>
        <p class="text-muted-foreground text-sm">
          {{ latNum().toFixed(4) }}, {{ lonNum().toFixed(4) }}
        </p>
        <a routerLink="/map" class="text-primary hover:text-primary/80 text-sm underline">
          ← Back to World Map
        </a>
      </div>

      <div class="mb-4">
        @if (totalCount() > 0) {
          <p class="text-muted-foreground text-sm">
            {{ totalCount() }} photos at this location
          </p>
        }
      </div>

      <div class="flex flex-1 overflow-y-auto">
        @if (allItems().length > 0) {
          <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            @for (asset of allItems(); track asset.id) {
              <app-asset-thumbnail
                [asset]="asset"
                [from]="fromPath()"
              />
            }
          </div>
          @if (files.hasNextPage()) {
            <div class="mt-6 flex justify-center">
              <button
                (click)="loadMore()"
                [disabled]="files.isFetchingNextPage()"
                class="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-6 py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                @if (files.isFetchingNextPage()) {
                  <span>Loading...</span>
                } @else {
                  <span>Load More</span>
                }
              </button>
            </div>
          }
        } @else {
          <div class="text-muted-foreground flex h-full items-center justify-center">
            <p>No photos found at this location</p>
          </div>
        }
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LocationDetail {
  lat = input.required<string>();
  lon = input.required<string>();

  latNum = computed(() => Number(this.lat()));
  lonNum = computed(() => Number(this.lon()));

  private readonly trpc = injectTrpc();

  fromPath = computed(() => `/locations/${this.lat()}/${this.lon()}`);

  files = injectInfiniteQuery(() => ({
    queryKey: [CacheKey.LocationSingle, this.lat(), this.lon()],
    queryFn: async ({ pageParam }) =>
      this.trpc.geoLocation.getFilesByLocation.query({
        lat: Number(this.lat()),
        lon: Number(this.lon()),
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

  totalCount = computed(() => {
    return this.allItems().length;
  });

  loadMore(): void {
    if (this.files.hasNextPage() && !this.files.isFetchingNextPage()) {
      this.files.fetchNextPage();
    }
  }
}
