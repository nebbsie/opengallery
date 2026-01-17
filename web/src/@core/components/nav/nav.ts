import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Logo } from '@core/components/logo/logo';
import { Auth } from '@core/services/auth/auth';
import { ScreenSize } from '@core/services/screen-size/screen-size';
import { Sidebar } from '@core/services/sidebar/sidebar';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideMenu, lucideSettings, lucideUpload } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIcon } from '@spartan-ng/helm/icon';

@Component({
  selector: 'app-nav',
  providers: [
    provideIcons({
      lucideUpload,
      lucideMenu,
      lucideSettings,
    }),
  ],
  imports: [HlmButton, NgIcon, HlmIcon, RouterLink, Logo],
  host: {
    class: 'flex w-full items-center border-b p-4 space-x-4 sticky top-0 z-50 bg-background',
  },
  template: `
    <button class="text-foreground" (click)="toggleSideNav()" hlmBtn variant="ghost" size="sm">
      <ng-icon hlm size="sm" name="lucideMenu" />
    </button>

    <a routerLink="/" (click)="clickLogo()">
      <app-logo [size]="26" />
    </a>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Nav {
  private readonly auth = inject(Auth);
  private readonly sidebar = inject(Sidebar);
  private readonly size = inject(ScreenSize);

  toggleSideNav() {
    this.sidebar.toggle();
  }

  clickLogo() {
    if (this.size.isMobile()) {
      this.sidebar.close();
    }
  }
}
