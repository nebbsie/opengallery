import { Component, inject } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs';
import { Toaster } from '@core/components/toaster/toaster';
import { UploadHost } from '@core/components/upload/upload-host';
import { MobileBottomNav } from '@core/components/side-nav/mobile-bottom-nav/mobile-bottom-nav';
import { SideNav } from '@core/components/side-nav/side-nav';
import { Auth } from '@core/services/auth/auth';
import { ScreenSize } from '@core/services/screen-size/screen-size';
import { UiSettingsService } from '@core/services/ui-settings/ui-settings';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideEye } from '@ng-icons/lucide';
import { HlmIcon } from '@spartan-ng/helm/icon';

@Component({
  selector: 'app-root',
  host: {
    // viewport-fit=cover: keep the app clear of notches; the bottom nav pads itself.
    class:
      'flex flex-col h-[100dvh] pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]',
  },
  template: `
    <!-- "View as" preview banner. Sits above everything in normal flow, so it
         never covers content on any screen size. -->
    @if (viewAs(); as preview) {
      <div
        role="status"
        class="z-50 flex shrink-0 items-center justify-between gap-3 bg-amber-500 px-3 py-1.5 text-sm text-amber-950"
      >
        <p class="flex min-w-0 items-center gap-2">
          <ng-icon hlm size="sm" name="lucideEye" class="shrink-0" />
          <span class="min-w-0 leading-tight">
            Viewing as <span class="font-semibold">{{ preview.name }}</span
            >. Read-only preview.
          </span>
        </p>
        <button
          type="button"
          class="shrink-0 rounded-md bg-amber-950 px-3 py-1 text-xs font-medium text-amber-50 hover:bg-amber-900"
          (click)="exitPreview()"
        >
          Exit preview
        </button>
      </div>
    }

    <!-- The rail and the page "window" float over the ambient backdrop. -->
    <main
      class="relative flex min-h-0 flex-1 overflow-hidden"
      [class]="isAssetRoute() ? '' : 'gap-2 p-2 sm:gap-3 sm:p-3'"
    >
      <!-- The photo viewer is full-bleed: no rail, no bottom nav, no padding. -->
      @if (isAuthenticated() && !isAssetRoute()) {
        <app-side-nav />
      }

      <div
        class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        [class]="
          isAssetRoute()
            ? 'bg-background'
            : isAuthenticated()
              ? 'glass-window rounded-2xl p-3 sm:rounded-3xl sm:p-4'
              : ''
        "
      >
        <!-- Clips the page (and its scroll areas) with corners concentric to
             the window's: window radius minus its padding (16-12, 24-16). -->
        <div
          class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          [class]="isAuthenticated() && !isAssetRoute() ? 'rounded-[4px] sm:rounded-[8px]' : ''"
        >
          <router-outlet />
        </div>
      </div>
    </main>

    <!-- Mobile primary nav lives at the bottom; hidden on sm+ (left rail there). -->
    @if (isAuthenticated() && !isSettingsRoute() && !isAssetRoute()) {
      <app-mobile-bottom-nav />
    }

    <!-- Upload progress panel, picker and drop target (uploads keep going
         across pages). -->
    @if (isAuthenticated()) {
      <app-upload-host />
    }

    <app-toaster />
  `,
  providers: [provideIcons({ lucideEye })],
  imports: [RouterOutlet, SideNav, MobileBottomNav, NgIcon, HlmIcon, Toaster, UploadHost],
})
export class App {
  private auth = inject(Auth);
  protected readonly size = inject(ScreenSize);
  private readonly router = inject(Router);
  // Ensure UI settings load on app start by injecting the singleton
  private readonly uiSettings = inject(UiSettingsService);

  isAuthenticated = this.auth.isAuthenticated;
  protected readonly viewAs = this.auth.viewAs;

  exitPreview() {
    this.auth.stopViewAs();
  }

  protected readonly isSettingsRoute = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.url.startsWith('/settings')),
      startWith(this.router.url.startsWith('/settings')),
    ),
    { initialValue: false },
  );

  protected readonly isAssetRoute = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.url.startsWith('/asset/')),
      startWith(this.router.url.startsWith('/asset/')),
    ),
    { initialValue: false },
  );
}
