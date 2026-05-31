import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  afterNextRender,
  inject,
} from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { PrefetchRouteDirective } from '@core/directives/prefetch-route/prefetch-route.directive';
import { Sidebar } from '@core/services/sidebar/sidebar';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideImages,
  lucideLayoutDashboard,
  lucideMap,
  lucideSettings,
  lucideUsers,
} from '@ng-icons/lucide';
import { HlmIcon } from '@spartan-ng/helm/icon';

// Primary navigation for mobile: a fixed bottom bar (the left rail is hidden on
// mobile for the default context). Order matches the request: All, Albums,
// Settings, Map, People.
//
// Auto-hide: scrolling down slides the bar out 1:1 with the scroll delta;
// scrolling up brings it back at the same rate (it tracks the drag, not a
// fixed animation). Disabled on the settings pages, where the bar stays pinned.
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
      'bg-background fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around border-t will-change-transform sm:hidden',
  },
  template: `
    @for (item of items; track item.path) {
      <a
        class="text-muted-foreground flex min-h-[3.5rem] flex-1 items-center justify-center py-4"
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
export class MobileBottomNav implements OnDestroy {
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly zone = inject(NgZone);
  private readonly sidebar = inject(Sidebar);

  protected readonly items = [
    { path: '/gallery', label: 'All', icon: 'lucideLayoutDashboard', exact: true },
    { path: '/albums', label: 'Albums', icon: 'lucideImages', exact: false },
    { path: '/settings', label: 'Settings', icon: 'lucideSettings', exact: false },
    { path: '/map', label: 'Map', icon: 'lucideMap', exact: false },
    { path: '/faces', label: 'People', icon: 'lucideUsers', exact: false },
  ];

  // Current hidden offset in px (0 = fully shown, navHeight = fully hidden).
  private offset = 0;
  private navHeight = 56;
  private lastTop = 0;
  private lastTarget: EventTarget | null = null;
  private readonly onScroll = (e: Event) => this.handleScroll(e);

  constructor() {
    afterNextRender(() => {
      this.navHeight = this.host.nativeElement.offsetHeight || this.navHeight;
      // Capture phase so we catch scrolls from any inner scroll container, not
      // just the window. Passive + outside Angular so it never triggers change
      // detection — we write the transform straight to the DOM.
      this.zone.runOutsideAngular(() => {
        document.addEventListener('scroll', this.onScroll, {
          capture: true,
          passive: true,
        });
      });
    });
  }

  ngOnDestroy(): void {
    document.removeEventListener('scroll', this.onScroll, { capture: true });
  }

  private handleScroll(e: Event): void {
    // Keep the bar pinned on settings pages (its sub-nav is the left rail).
    if (this.sidebar.content() === 'settings') {
      this.apply(0);
      return;
    }

    const target = e.target;
    const top =
      !target || target === document || target === document.documentElement
        ? (document.scrollingElement?.scrollTop ?? 0)
        : (target as HTMLElement).scrollTop;

    // Different scroll container (e.g. after navigation): re-baseline, no move.
    if (target !== this.lastTarget) {
      this.lastTarget = target;
      this.lastTop = top;
      return;
    }

    const delta = top - this.lastTop;
    this.lastTop = top;
    if (!this.navHeight) this.navHeight = this.host.nativeElement.offsetHeight || 56;
    // Scroll down (delta > 0) hides; scroll up (delta < 0) reveals — 1:1.
    this.apply(Math.min(this.navHeight, Math.max(0, this.offset + delta)));
  }

  private apply(value: number): void {
    if (value === this.offset) return;
    this.offset = value;
    this.host.nativeElement.style.transform = `translateY(${value}px)`;
  }
}
