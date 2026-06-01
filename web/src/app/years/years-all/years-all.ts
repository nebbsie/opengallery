import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ErrorAlert } from '@core/components/error/error';
import { Loading } from '@core/components/loading/loading';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { environment } from '@env/environment';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCalendar } from '@ng-icons/lucide';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { injectQuery } from '@tanstack/angular-query-experimental';

@Component({
  selector: 'app-years-all',
  imports: [ErrorAlert, Loading, RouterLink, NgIcon, HlmIcon],
  providers: [provideIcons({ lucideCalendar })],
  host: { class: 'block h-full overflow-y-auto' },
  template: `
    @if (years.isPending() && !years.data()) {
      <app-loading />
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
              class="flex w-full cursor-pointer flex-col gap-1"
              [routerLink]="['/years', entry.year ?? 'no-date']"
            >
              <div class="relative">
                @if (entry.cover) {
                  <img
                    [src]="apiUrl + '/asset/' + entry.cover + '/thumbnail'"
                    [alt]="entry.year ?? 'No Date'"
                    class="aspect-square w-full rounded-lg object-cover"
                  />
                } @else {
                  <div class="relative aspect-square w-full rounded-lg bg-[var(--secondary)] ring-1 ring-[var(--border)]">
                    <div class="absolute inset-0 grid place-items-center">
                      <div class="flex items-center justify-center rounded-full bg-[var(--muted)] p-4">
                        <ng-icon hlm name="lucideCalendar" class="size-10 text-[var(--muted-foreground)]" />
                      </div>
                    </div>
                  </div>
                }
              </div>
              <div class="flex flex-col px-2">
                <p class="text-sm font-bold">{{ entry.year ?? 'No Date' }}</p>
                <p class="text-xs font-light">{{ entry.count }} items</p>
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
  private readonly trpc = injectTrpc();

  years = injectQuery(() => ({
    queryKey: [CacheKey.YearsAll],
    queryFn: async () => this.trpc.years.getYears.query(),
  }));
}
