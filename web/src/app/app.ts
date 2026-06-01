import { Component, inject } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs';
import { MobileBottomNav } from '@core/components/side-nav/mobile-bottom-nav/mobile-bottom-nav';
import { SideNav } from '@core/components/side-nav/side-nav';
import { Auth } from '@core/services/auth/auth';
import { ScreenSize } from '@core/services/screen-size/screen-size';
import { UiSettingsService } from '@core/services/ui-settings/ui-settings';

@Component({
  selector: 'app-root',
  host: {
    class: 'flex flex-col h-[100dvh]',
  },
  template: `
    <main class="relative flex min-h-0 flex-1 overflow-hidden">
      <!-- The left rail and content padding fall away on immersive routes (the
           photo viewer) so a single asset can fill the screen edge to edge. -->
      @if (isAuthenticated() && !isImmersiveRoute()) {
        <app-side-nav />
      }

      <div
        class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        [class.p-3]="!isImmersiveRoute()"
      >
        <router-outlet />
      </div>
    </main>

    <!-- Mobile primary nav lives at the bottom; hidden on sm+ (left rail there)
         and on settings/immersive routes. -->
    @if (isAuthenticated() && !isSettingsRoute() && !isImmersiveRoute()) {
      <app-mobile-bottom-nav />
    }
  `,
  imports: [RouterOutlet, SideNav, MobileBottomNav],
})
export class App {
  private auth = inject(Auth);
  protected readonly size = inject(ScreenSize);
  private readonly router = inject(Router);
  // Ensure UI settings load on app start by injecting the singleton
  private readonly uiSettings = inject(UiSettingsService);

  isAuthenticated = this.auth.isAuthenticated;

  protected readonly isSettingsRoute = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.url.startsWith('/settings')),
      startWith(this.router.url.startsWith('/settings')),
    ),
    { initialValue: false },
  );

  // Immersive routes hide all app chrome so the content fills the viewport. The
  // single-asset viewer is the only one today.
  protected readonly isImmersiveRoute = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.url.startsWith('/asset/')),
      startWith(this.router.url.startsWith('/asset/')),
    ),
    { initialValue: this.router.url.startsWith('/asset/') },
  );
}
