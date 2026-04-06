import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AssetThumbnail } from '@core/components/asset-thumbnail/asset-thumbnail';
import { ErrorAlert } from '@core/components/error/error';
import { VirtualThumbnailGrid } from '@core/components/virtual-thumbnail-grid/virtual-thumbnail-grid';
import { CacheKey } from '@core/services/cache-key.types';
import { ScrollPosition } from '@core/services/scroll-position/scroll-position';
import { injectTrpc } from '@core/services/trpc';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCirclePause, lucideCirclePlay, lucideImagePlus } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { injectInfiniteQuery, injectQuery } from '@tanstack/angular-query-experimental';

@Component({
  selector: 'app-gallery-all',
  providers: [
    provideIcons({
      lucideCirclePlay,
      lucideCirclePause,
      lucideImagePlus,
    }),
  ],
  imports: [
    HlmSpinner,
    ErrorAlert,
    AssetThumbnail,
    RouterLink,
    HlmButton,
    VirtualThumbnailGrid,
    NgIcon,
    HlmIcon,
  ],
  host: { class: 'block h-full' },
  template: `
    @if (files.isPending() && !files.data()) {
      <hlm-spinner />
    } @else if (files.isError() && !files.data()) {
      <app-error-alert [error]="files.error()" />
    } @else {
      @if (!allItems().length) {
        <div class="text-muted-foreground flex flex-col items-center justify-center py-12">
          <ng-icon hlm size="xl" name="lucideImagePlus" class="mb-4" />
          <p>No assets yet</p>
          <p class="mb-4 text-sm">Add a source folder to import your library</p>
          <a hlmBtn routerLink="/settings/sources">Go to Source Folders</a>
        </div>
      } @else {
        <app-virtual-thumbnail-grid
          [items]="allItems()"
          [hasMore]="files.hasNextPage()"
          [isLoadingMore]="files.isFetchingNextPage()"
          [scrollKey]="'gallery-all'"
          [pageCount]="pageCount()"
          [dateAccessor]="timelineDate"
          [timelineData]="timelineResult.data() ?? null"
          (loadMore)="loadMore()"
          (seekTo)="onSeekTo($event)"
        >
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
  private readonly scrollPosition = inject(ScrollPosition);
  protected readonly timelineDate = (item: {
    sortAt?: Date | string | null;
    takenAt?: Date | string | null;
    createdAt?: Date | string | null;
  }) => item.sortAt ?? item.takenAt ?? item.createdAt ?? null;

  timelineResult = injectQuery(() => ({
    queryKey: [CacheKey.TimelineAll],
    queryFn: () => this.trpc.files.getTimeline.query({ kind: 'all' }),
    staleTime: 5 * 60 * 1000,
  }));

  private readonly seekCursor = signal<string | null>(null);

  files = injectInfiniteQuery(() => {
    const seek = this.seekCursor();
    return {
      queryKey: [CacheKey.GalleryAll, { seekCursor: seek }],
      queryFn: async ({ pageParam }) =>
        this.trpc.files.getUsersFiles.query({
          kind: 'all',
          limit: 500,
          cursor: pageParam,
          seekCursor: !pageParam ? seek : undefined,
        }),
      initialPageParam: null as string | null,
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      staleTime: 5 * 60 * 1000,
      refetchPage: (_page: unknown, index: number) =>
        index <= this.scrollPosition.getPageIndex('gallery-all'),
    };
  });

  allItems = computed(() => {
    const data = this.files.data();
    if (!data) return [];
    return data.pages.flatMap((page) => page.items);
  });

  pageCount = computed(() => this.files.data()?.pages.length ?? 0);

  loadMore(): void {
    if (this.files.hasNextPage() && !this.files.isFetchingNextPage()) {
      this.files.fetchNextPage();
    }
  }

  onSeekTo(target: { year: number; month: number }): void {
    // Build a date string for the start of the next month (data is sorted DESC, cursor uses <)
    const nextMonth = target.month === 12 ? 1 : target.month + 1;
    const nextYear = target.month === 12 ? target.year + 1 : target.year;
    const cursor = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01 00:00:00`;
    this.seekCursor.set(cursor);
  }
}
