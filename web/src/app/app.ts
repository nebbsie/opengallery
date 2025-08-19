import { Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Nav } from '@core/components/nav/nav';
import { SideNav } from '@core/components/side-nav/side-nav';
import { Auth } from '@core/services/auth/auth';

@Component({
  selector: 'app-root',
  host: {
    class: 'flex flex-col h-screen',
  },
  template: `
    @if (isAuthenticated()) {
      <app-nav (sideNavToggle)="showSideNav.set(!showSideNav())" />
    }
    <main class="relative flex flex-1">
      @if (isAuthenticated()) {
        <div
          class="bg-background absolute inset-0 z-50 transition-transform duration-150 ease-in-out sm:hidden"
          [class.-translate-x-full]="!showSideNav()"
          [class.translate-x-0]="showSideNav()"
          [class.pointer-events-none]="!showSideNav()"
          [attr.aria-hidden]="!showSideNav()"
        >
          <app-side-nav (sideNavToggle)="showSideNav.set(!showSideNav())" />
        </div>
      }

      @if (isAuthenticated()) {
        <div
          class="hidden shrink-0 overflow-hidden transition-[width] duration-150 ease-in-out sm:block"
          [style.width.px]="showSideNav() ? 250 : 0"
          [attr.aria-hidden]="!showSideNav()"
          [class.pointer-events-none]="!showSideNav()"
        >
          <app-side-nav />
        </div>
      }

      <router-outlet />
    </main>
  `,
  imports: [RouterOutlet, Nav, SideNav],
})
export class App {
  private auth = inject(Auth);

  isAuthenticated = this.auth.isAuthenticated;

  showSideNav = signal(true);
}
