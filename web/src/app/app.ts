import { Component, computed, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Logo } from '@core/components/logo/logo';
import { Auth } from '@core/services/auth/auth';
import { NgIcon } from '@ng-icons/core';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { Nav } from '@core/components/nav/nav';

@Component({
  selector: 'app-root',
  host: {
    class: 'flex flex-col h-screen',
  },
  template: `
    @if (showTopNav()) {
      <app-nav />
    }
    <main class="flex-1 overflow-scroll">
      <router-outlet />
    </main>
  `,
  imports: [RouterOutlet, Nav],
})
export class App {
  private auth = inject(Auth);

  showTopNav = computed(() => this.auth.isAuthenticated());
}
