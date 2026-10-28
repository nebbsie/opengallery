import { Component, inject } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs';
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
    class: 'flex flex-col h-[100dvh]',
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
            Viewing as <span class="font-semibold">{{ preview.name }}</span>. Read-only preview.
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

    <main class="relative flex min-h-0 flex-1 overflow-hidden">
      @if (isAuthenticated()) {
        <app-side-nav />
      }

      <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-3">
        <router-outlet />
      </div>
    </main>

    <!-- Mobile primary nav lives at the bottom; hidden on sm+ (left rail there). -->
    @if (isAuthenticated() && !isSettingsRoute()) {
      <app-mobile-bottom-nav />
    }
  `,
  providers: [provideIcons({ lucideEye })],
  imports: [RouterOutlet, SideNav, MobileBottomNav, NgIcon, HlmIcon],
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
}
