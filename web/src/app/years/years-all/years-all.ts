import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ErrorAlert } from '@core/components/error/error';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { environment } from '@env/environment';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCalendar } from '@ng-icons/lucide';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { injectQuery } from '@tanstack/angular-query-experimental';

@Component({
  selector: 'app-years-all',
  imports: [ErrorAlert, RouterLink, NgIcon, HlmIcon],
  providers: [provideIcons({ lucideCalendar })],
  host: { class: 'block h-full overflow-y-auto' },
  template: `
    @if (years.isPending() && !years.data()) {
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        @for (i of skeletonTiles; track i) {
          <div class="flex flex-col gap-2">
            <div class="bg-muted aspect-square w-full animate-pulse rounded-xl"></div>
            <div class="flex flex-col gap-1 px-1">
              <div class="bg-muted h-4 w-1/2 animate-pulse rounded"></div>
              <div class="bg-muted h-3 w-1/3 animate-pulse rounded"></div>
            </div>
          </div>
        }
      </div>
    } @else if (years.isError() && !years.data()) {
      <app-error-alert [error]="years.error()" />
    } @else {
      @if (years.data()!.length === 0) {
        <div class="text-muted-foreground flex flex-col items-center justify-center py-12">
          <ng-icon hlm size="xl" name="lucideCalendar" class="mb-4" />
          <p>No photos found</p>
        </div>
      } @else {
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          @for (entry of years.data()!; track entry.year) {
            <a
              class="group flex w-full cursor-pointer flex-col gap-2"
              [routerLink]="['/years', entry.year ?? 'no-date']"
            >
              <div
                class="ring-border/60 relative aspect-square w-full overflow-hidden rounded-xl shadow-sm ring-1 transition-all duration-300 group-hover:shadow-lg group-hover:ring-foreground/20"
              >
                @if (entry.cover) {
                  <img
                    [src]="apiUrl + '/asset/' + entry.cover + '/thumbnail'"
                    [alt]="entry.year ?? 'No Date'"
                    class="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]"
                  />
                } @else {
                  <div class="grid h-full w-full place-items-center bg-gradient-to-br from-secondary to-muted">
                    <div class="bg-background/40 flex items-center justify-center rounded-full p-4 backdrop-blur-sm">
                      <ng-icon hlm name="lucideCalendar" class="text-muted-foreground size-9" />
                    </div>
                  </div>
                }
              </div>
              <div class="flex flex-col px-1">
                <p class="text-foreground text-sm font-semibold">{{ entry.year ?? 'No Date' }}</p>
                <p class="text-muted-foreground text-xs">{{ entry.count }} items</p>
              </div>
            </a>
          }
        </div>
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class YearsAll {
  protected readonly apiUrl = environment.api.url;
  protected readonly skeletonTiles = Array.from({ length: 10 }, (_, i) => i);
  private readonly trpc = injectTrpc();

  years = injectQuery(() => ({
    queryKey: [CacheKey.YearsAll],
    queryFn: async () => this.trpc.years.getYears.query(),
  }));
}
