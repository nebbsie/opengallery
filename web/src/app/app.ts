import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SideNav } from '@core/components/side-nav/side-nav';
import { Auth } from '@core/services/auth/auth';
import { ScreenSize } from '@core/services/screen-size/screen-size';
import { UiSettingsService } from '@core/services/ui-settings/ui-settings';

@Component({
  selector: 'app-root',
  host: {
    class: 'flex flex-col h-screen',
  },
  template: `
    <main class="relative flex flex-1 overflow-hidden">
      @if (isAuthenticated()) {
        <app-side-nav />
      }

      <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-3">
        <router-outlet />
      </div>
    </main>
  `,
  imports: [RouterOutlet, SideNav],
})
export class App {
  private auth = inject(Auth);
  protected readonly size = inject(ScreenSize);
  // Ensure UI settings load on app start by injecting the singleton
  private readonly uiSettings = inject(UiSettingsService);

  isAuthenticated = this.auth.isAuthenticated;
}
