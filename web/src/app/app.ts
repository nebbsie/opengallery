import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Nav } from '@core/components/nav/nav';
import { SideNav } from '@core/components/side-nav/side-nav';
import { Auth } from '@core/services/auth/auth';
import { ScreenSize } from '@core/services/screen-size/screen-size';
import { Sidebar } from '@core/services/sidebar/sidebar';

@Component({
  selector: 'app-root',
  host: {
    class: 'flex flex-col h-screen',
  },
  template: `
    @if (isAuthenticated()) {
      <app-nav />
    }
    <main class="relative flex flex-1">
      @if (isAuthenticated()) {
        <div
          class="bg-background absolute inset-0 z-50 transition-transform duration-150 ease-in-out sm:static sm:inset-auto sm:z-auto sm:shrink-0 sm:overflow-hidden sm:transition-[width] sm:duration-150 sm:ease-in-out"
          [class.-translate-x-full]="!sidebar.isOpen() && !size.isSmUp()"
          [class.translate-x-0]="sidebar.isOpen() || size.isSmUp()"
          [class.pointer-events-none]="!sidebar.isOpen() && !size.isSmUp()"
          [style.width.px]="size.isSmUp() ? (sidebar.isOpen() ? 250 : 0) : null"
          [attr.aria-hidden]="!sidebar.isOpen() && !size.isSmUp()"
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
  protected readonly sidebar = inject(Sidebar);
  protected readonly size = inject(ScreenSize);

  isAuthenticated = this.auth.isAuthenticated;
}
