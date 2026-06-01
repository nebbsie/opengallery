import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Logo } from '@core/components/logo/logo';
import { NavRailItem } from '@core/components/side-nav/nav-rail-item/nav-rail-item';
import { SideNavDefault } from '@core/components/side-nav/side-nav-default/side-nav-default';
import { SideNavSettings } from '@core/components/side-nav/side-nav-settings/side-nav-settings';
import { Sidebar } from '@core/services/sidebar/sidebar';
import { injectTrpc } from '@core/services/trpc';
import { provideIcons } from '@ng-icons/core';
import {
  lucideActivity,
  lucideBadgeAlert,
  lucideCalendar,
  lucideCamera,
  lucideChevronLeft,
  lucideCopy,
  lucideDatabase,
  lucideFilm,
  lucideHardDrive,
  lucideImage,
  lucideImages,
  lucideLayoutDashboard,
  lucideListChecks,
  lucideLogs,
  lucideMap,
  lucideMapPin,
  lucideMonitor,
  lucideScanFace,
  lucideSettings,
  lucideUser,
  lucideUsers,
} from '@ng-icons/lucide';
import { injectQuery } from '@tanstack/angular-query-experimental';

@Component({
  selector: 'app-side-nav',
  imports: [SideNavDefault, SideNavSettings, NavRailItem, Logo, RouterLink],
  providers: [
    provideIcons({
      lucideLayoutDashboard,
      lucideImage,
      lucideFilm,
      lucideUsers,
      lucideImages,
      lucideCalendar,
      lucideCamera,
      lucideMap,
      lucideUser,
      lucideMonitor,
      lucideHardDrive,
      lucideActivity,
      lucideScanFace,
      lucideMapPin,
      lucideDatabase,
      lucideCopy,
      lucideListChecks,
      lucideBadgeAlert,
      lucideLogs,
      lucideSettings,
      lucideChevronLeft,
    }),
  ],
  // Fixed-width gutter in the layout flow (so content never reflows); the panel
  // inside expands on hover as an overlay. Hidden on mobile for the default
  // context (bottom nav takes over) but forced visible for the settings sub-nav.
  host: {
    class: 'relative z-50 hidden h-full w-16 shrink-0 sm:block',
    '[class.!block]': "sideBarType() === 'settings'",
  },
  template: `
    <nav
      class="group/nav glass absolute inset-y-0 left-0 flex w-16 flex-col overflow-hidden border-r transition-[width,box-shadow] duration-200 ease-out hover:w-60 hover:shadow-2xl"
    >
      <!-- Brand -->
      <a routerLink="/" class="flex h-16 shrink-0 items-center">
        <span class="grid w-16 shrink-0 place-items-center">
          <app-logo [size]="24" />
        </span>
        <span
          class="text-foreground translate-x-1 text-sm font-semibold tracking-tight whitespace-nowrap opacity-0 transition-all duration-200 group-hover/nav:translate-x-0 group-hover/nav:opacity-100"
        >
          Open Gallery
        </span>
      </a>

      <!-- Primary navigation -->
      <div class="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto pb-2">
        @switch (sideBarType()) {
          @case ('settings') {
            <app-side-nav-settings />
          }
          @default {
            <app-side-nav-default />
          }
        }
      </div>

      <!-- Footer action -->
      <div class="shrink-0 border-t px-2 py-2">
        @if (sideBarType() === 'settings') {
          <app-nav-rail-item icon="lucideChevronLeft" label="Back to Gallery" link="/" />
        } @else {
          <app-nav-rail-item
            icon="lucideSettings"
            label="Settings"
            link="/settings"
            [badge]="pendingCount()"
          />
        }
      </div>
    </nav>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SideNav {
  private readonly sidebar = inject(Sidebar);
  private readonly trpc = injectTrpc();

  sideBarType = this.sidebar.content;

  private readonly queueCounts = injectQuery(() => ({
    queryKey: ['queue', 'encodingCounts'],
    queryFn: () => this.trpc.queue.encodingCounts.query(),
    refetchInterval: 10_000,
  }));

  protected readonly pendingCount = computed(() => this.queueCounts.data()?.totalPending ?? 0);
}
