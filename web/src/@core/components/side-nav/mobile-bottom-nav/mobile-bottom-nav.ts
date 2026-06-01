import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { PrefetchRouteDirective } from '@core/directives/prefetch-route/prefetch-route.directive';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideImages,
  lucideLayoutDashboard,
  lucideMap,
  lucideSettings,
  lucideUsers,
} from '@ng-icons/lucide';
import { HlmIcon } from '@spartan-ng/helm/icon';

// Primary navigation for mobile: a bottom bar that lives in normal layout flow
// (the left rail is hidden on mobile for the default context). It sits beneath
// the scrolling content area as a sibling, so the page never renders underneath
// it and no clearance padding is needed. Order: All, Albums, Settings, Map,
// People.
@Component({
  selector: 'app-mobile-bottom-nav',
  imports: [RouterLink, RouterLinkActive, PrefetchRouteDirective, NgIcon, HlmIcon],
  providers: [
    provideIcons({
      lucideLayoutDashboard,
      lucideImages,
      lucideSettings,
      lucideMap,
      lucideUsers,
    }),
  ],
  host: {
    class:
      'bg-background z-40 flex shrink-0 items-stretch justify-around border-t sm:hidden',
  },
  template: `
    @for (item of items; track item.path) {
      <a
        class="text-muted-foreground flex min-h-[3.5rem] flex-1 items-center justify-center py-4 transition-transform duration-100 active:scale-75"
        [routerLink]="item.path"
        flPrefetchRoute
        routerLinkActive="text-primary"
        [routerLinkActiveOptions]="{ exact: item.exact }"
        [attr.aria-label]="item.label"
      >
        <ng-icon hlm size="base" [name]="item.icon" />
      </a>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MobileBottomNav {
  protected readonly items = [
    { path: '/gallery', label: 'All', icon: 'lucideLayoutDashboard', exact: true },
    { path: '/albums', label: 'Albums', icon: 'lucideImages', exact: false },
    { path: '/settings', label: 'Settings', icon: 'lucideSettings', exact: false },
    { path: '/map', label: 'Map', icon: 'lucideMap', exact: false },
    { path: '/faces', label: 'People', icon: 'lucideUsers', exact: false },
  ];
}
