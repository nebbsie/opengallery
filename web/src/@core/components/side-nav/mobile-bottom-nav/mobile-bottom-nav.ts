import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { PrefetchRouteDirective } from '@core/directives/prefetch-route/prefetch-route.directive';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCalendar,
  lucideCamera,
  lucideEllipsis,
  lucideFilm,
  lucideImage,
  lucideImages,
  lucideMap,
  lucideSearch,
  lucideSettings,
  lucideUpload,
  lucideUsers,
} from '@ng-icons/lucide';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { Auth } from '@core/services/auth/auth';
import { UploadService } from '@core/services/upload/upload';
import { filter, map } from 'rxjs';

type NavItem = { path: string; label: string; icon: string; exact?: boolean };

// Primary navigation for mobile: a bottom bar in normal layout flow (the left
// rail is hidden on mobile). Photos, Search, People, Albums and More. More opens
// a sheet with the other sections. Each tab has a text label, a 44px+ target
// and room for the home indicator (safe-area inset).
@Component({
  selector: 'app-mobile-bottom-nav',
  imports: [RouterLink, RouterLinkActive, PrefetchRouteDirective, NgIcon, HlmIcon],
  providers: [
    provideIcons({
      lucideImage,
      lucideSearch,
      lucideUsers,
      lucideImages,
      lucideEllipsis,
      lucideFilm,
      lucideCalendar,
      lucideCamera,
      lucideMap,
      lucideSettings,
      lucideUpload,
    }),
  ],
  host: {
    class:
      'bg-background z-40 flex shrink-0 items-stretch justify-around border-t pb-[env(safe-area-inset-bottom)] sm:hidden',
  },
  template: `
    <nav class="flex w-full items-stretch" aria-label="Main">
      @for (item of tabs; track item.path) {
        <a
          class="text-muted-foreground flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 pt-1.5 pb-1 text-[11px] font-medium transition-[color,scale] duration-100 active:scale-[0.96]"
          [routerLink]="item.path"
          flPrefetchRoute
          routerLinkActive="!text-foreground"
          #rla="routerLinkActive"
          [routerLinkActiveOptions]="{ exact: !!item.exact }"
          [attr.aria-current]="rla.isActive ? 'page' : null"
          (click)="moreOpen.set(false)"
        >
          <span
            class="grid h-7 w-14 place-items-center rounded-full transition-colors duration-150"
            [class.bg-accent]="rla.isActive"
          >
            <ng-icon hlm size="sm" [name]="item.icon" />
          </span>
          {{ item.label }}
        </a>
      }
      <button
        type="button"
        class="text-muted-foreground flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 pt-1.5 pb-1 text-[11px] font-medium transition-[color,scale] duration-100 active:scale-[0.96]"
        [class.!text-foreground]="moreOpen() || moreActive()"
        aria-haspopup="dialog"
        [attr.aria-expanded]="moreOpen()"
        (click)="moreOpen.set(!moreOpen())"
      >
        <span
          class="grid h-7 w-14 place-items-center rounded-full transition-colors duration-150"
          [class.bg-accent]="moreOpen() || moreActive()"
        >
          <ng-icon hlm size="sm" name="lucideEllipsis" />
        </span>
        More
      </button>
    </nav>

    @if (moreOpen()) {
      <div
        class="fixed inset-0 z-50 bg-black/40 motion-safe:animate-in motion-safe:fade-in-0"
        aria-hidden="true"
        (click)="moreOpen.set(false)"
      ></div>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="More"
        class="bg-background fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t px-3 pt-2 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] shadow-2xl motion-safe:animate-in motion-safe:slide-in-from-bottom-4"
        (keydown.escape)="moreOpen.set(false)"
      >
        <div class="bg-muted mx-auto mb-3 h-1 w-10 rounded-full" aria-hidden="true"></div>
        <ul class="flex flex-col">
          @if (canUpload()) {
            <li>
              <button
                type="button"
                class="hover:bg-accent flex min-h-12 w-full items-center gap-4 rounded-lg px-3 text-base transition-[background-color,scale] duration-100 active:scale-[0.98]"
                (click)="openUpload()"
              >
                <ng-icon hlm size="sm" name="lucideUpload" class="text-muted-foreground" />
                Upload photos and videos
              </button>
            </li>
          }
          @for (item of more; track item.path) {
            <li>
              <a
                class="hover:bg-accent flex min-h-12 items-center gap-4 rounded-lg px-3 text-base transition-[background-color,scale] duration-100 active:scale-[0.98]"
                [routerLink]="item.path"
                flPrefetchRoute
                routerLinkActive="bg-accent font-medium"
                [routerLinkActiveOptions]="{ exact: !!item.exact }"
                (click)="moreOpen.set(false)"
              >
                <ng-icon hlm size="sm" [name]="item.icon" class="text-muted-foreground" />
                {{ item.label }}
              </a>
            </li>
          }
        </ul>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MobileBottomNav {
  private readonly router = inject(Router);
  private readonly uploads = inject(UploadService);
  private readonly auth = inject(Auth);
  // "View as" is read-only, so no uploads there.
  protected readonly canUpload = computed(() => !this.auth.viewAs());

  protected openUpload() {
    this.moreOpen.set(false);
    this.uploads.openPicker();
  }

  protected readonly moreOpen = signal(false);

  protected readonly tabs: NavItem[] = [
    { path: '/gallery', label: 'Photos', icon: 'lucideImage', exact: true },
    { path: '/search', label: 'Search', icon: 'lucideSearch' },
    { path: '/faces', label: 'People', icon: 'lucideUsers' },
    { path: '/albums', label: 'Albums', icon: 'lucideImages' },
  ];

  protected readonly more: NavItem[] = [
    { path: '/gallery/videos', label: 'Videos', icon: 'lucideFilm' },
    { path: '/years', label: 'Years', icon: 'lucideCalendar' },
    { path: '/cameras', label: 'Cameras', icon: 'lucideCamera' },
    { path: '/map', label: 'Map', icon: 'lucideMap' },
    { path: '/settings', label: 'Settings', icon: 'lucideSettings' },
  ];

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  // More is highlighted when the page is one of its sections.
  protected readonly moreActive = computed(() => {
    const url = this.url();
    return this.more.some((m) => url === m.path || url.startsWith(`${m.path}/`) || url.startsWith(`${m.path}?`));
  });
}
