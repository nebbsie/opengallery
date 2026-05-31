import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
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
      @if (isAuthenticated()) {
        <app-side-nav />
      }

      <!-- Full height with no bottom reserve: the mobile bottom nav is fixed and
           floats over the content, so each scroll surface extends underneath it
           and reveals more as the nav auto-hides. Surfaces add their own bottom
           padding so the last items clear the nav while it's shown. -->
      <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-3">
        <router-outlet />
      </div>
    </main>

    <!-- Mobile primary nav lives at the bottom; hidden on sm+ (left rail there). -->
    @if (isAuthenticated()) {
      <app-mobile-bottom-nav />
    }
  `,
  imports: [RouterOutlet, SideNav, MobileBottomNav],
})
export class App {
  private auth = inject(Auth);
  protected readonly size = inject(ScreenSize);
  // Ensure UI settings load on app start by injecting the singleton
  private readonly uiSettings = inject(UiSettingsService);

  isAuthenticated = this.auth.isAuthenticated;
}
