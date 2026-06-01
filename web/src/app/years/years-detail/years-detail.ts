import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { AssetThumbnail } from '@core/components/asset-thumbnail/asset-thumbnail';
import { BackOnEscapeDirective } from '@core/directives/back-on-escape/back-on-escape.directive';
import { ErrorAlert } from '@core/components/error/error';
import { Loading } from '@core/components/loading/loading';
import { VirtualThumbnailGrid } from '@core/components/virtual-thumbnail-grid/virtual-thumbnail-grid';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { injectInfiniteQuery, injectQuery } from '@tanstack/angular-query-experimental';

@Component({
  selector: 'app-years-detail',
  imports: [ErrorAlert, Loading, AssetThumbnail, VirtualThumbnailGrid],
  hostDirectives: [BackOnEscapeDirective],
  host: { class: 'flex flex-col h-full' },
  template: `
    @if (files.isPending() && !files.data()) {
      <app-loading />
    } @else if (files.isError() && !files.data()) {
      <app-error-alert [error]="files.error()" />
    } @else {
      @if (allItems().length === 0) {
        <p class="text-muted-foreground text-sm">No photos found.</p>
      } @else {
        <app-virtual-thumbnail-grid
          class="min-h-0 flex-1"
          [items]="allItems()"
          [hasMore]="files.hasNextPage()"
          [isLoadingMore]="files.isFetchingNextPage()"
          [scrollKey]="scrollKey()"
          [pageCount]="pageCount()"
          [dateAccessor]="dateAccessor"
          [timelineData]="timelineResult.data() ?? null"
          [showMonthDots]="true"
          (loadMore)="loadMore()"
          (seekTo)="onSeekTo($event)"
        >
          <ng-template let-asset>
            <app-asset-thumbnail [from]="fromPath()" [asset]="asset" />
          </ng-template>
        </app-virtual-thumbnail-grid>
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class YearsDetail {
  year = input.required<string>();

  private readonly trpc = injectTrpc();

  private yearParam = computed(() => (this.year() === 'no-date' ? null : Number(this.year())));
  fromPath = computed(() => `/years/${this.year()}`);
  scrollKey = computed(() => `year-${this.year()}`);

  protected readonly dateAccessor = (item: {
    sortAt?: Date | string | null;
    takenAt?: Date | string | null;
    createdAt?: Date | string | null;
  }) => item.sortAt ?? item.takenAt ?? item.createdAt ?? null;

  private readonly seekCursor = signal<string | null>(null);

  timelineResult = injectQuery(() => ({
    queryKey: [CacheKey.YearTimeline, this.year()],
    queryFn: () => this.trpc.years.getTimelineByYear.query({ year: this.yearParam() }),
    staleTime: 5 * 60 * 1000,
  }));

  files = injectInfiniteQuery(() => {
    const seek = this.seekCursor();
    return {
      queryKey: [CacheKey.YearSingle, this.year(), { seekCursor: seek }],
      queryFn: async ({ pageParam }) =>
        this.trpc.years.getFilesByYear.query({
          year: this.yearParam(),
          limit: 60,
          cursor: pageParam,
          seekCursor: !pageParam ? seek : undefined,
        }),
      initialPageParam: null as string | null,
      getNextPageParam: (lastPage) => lastPage.nextCursor,
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
    const nextMonth = target.month === 12 ? 1 : target.month + 1;
    const nextYear = target.month === 12 ? target.year + 1 : target.year;
    const cursor = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01 00:00:00`;
    this.seekCursor.set(cursor);
  }
}
