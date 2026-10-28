import { ChangeDetectionStrategy, Component } from '@angular/core';
import { AlbumThumbnail } from '@core/components/album-thumbnail/album-thumbnail';
import { ErrorAlert } from '@core/components/error/error';
import { VirtualThumbnailGrid } from '@core/components/virtual-thumbnail-grid/virtual-thumbnail-grid';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideImages } from '@ng-icons/lucide';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { injectQuery } from '@tanstack/angular-query-experimental';

@Component({
  selector: 'app-album-all',
  imports: [
    ErrorAlert,
    HlmIcon,
    NgIcon,
    AlbumThumbnail,
    VirtualThumbnailGrid,
  ],
  providers: [provideIcons({ lucideImages })],
  host: { class: 'flex flex-col h-full' },
  template: `
    @if (response.isPending() && !response.data()) {
      <div
        class="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-2 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] lg:grid-cols-[repeat(auto-fill,minmax(200px,1fr))]"
        aria-busy="true"
        aria-label="Loading albums"
      >
        @for (i of skeleton; track i) {
          <div class="flex flex-col gap-1">
            <div class="bg-muted aspect-square w-full animate-pulse rounded-lg"></div>
            <div class="flex flex-col gap-1.5 px-2 pt-1">
              <div class="bg-muted h-3.5 w-3/4 animate-pulse rounded"></div>
              <div class="bg-muted h-3 w-1/3 animate-pulse rounded"></div>
            </div>
          </div>
        }
      </div>
    } @else if (response.isError() && !response.data()) {
      <app-error-alert [error]="response.error()" />
    } @else {
      @if (response.data()!.length === 0) {
        <div class="text-muted-foreground flex flex-col items-center justify-center py-12">
          <ng-icon hlm size="xl" name="lucideImages" class="mb-4" />
          <p class="text-foreground font-medium">No albums yet</p>
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
    // Poll only while some album still has photos being processed, so the
    // import badges update. When all work is done, the list stops polling.
    refetchInterval: (query: { state: { data?: unknown } }) =>
      (query.state.data as Array<{ pendingTasks?: number }> | undefined)?.some(
        (a) => (a.pendingTasks ?? 0) > 0,
      )
        ? 5000
        : false,
  }));

  protected readonly skeleton = Array.from({ length: 12 }, (_, i) => i);
}
