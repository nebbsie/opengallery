import { NgOptimizedImage } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Auth } from '@core/services/auth/auth';
import { Logo } from '@core/components/logo/logo';
import { ScreenSize } from '@core/services/screen-size/screen-size';
import { Sidebar } from '@core/services/sidebar/sidebar';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideMenu,
  lucideUpload,
} from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIcon } from '@spartan-ng/helm/icon';

@Component({
  selector: 'app-nav',
  providers: [
    provideIcons({
      lucideUpload,
      lucideMenu,
    }),
  ],
  imports: [
    NgOptimizedImage,
    HlmButton,
    NgIcon,
    HlmIcon,
    RouterLink,
    Logo,
  ],
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

    <button class="text-foreground ml-auto" hlmBtn variant="ghost" size="sm">
      <ng-icon hlm size="sm" name="lucideUpload" />
      Upload
    </button>

    <a routerLink="/settings/profile">
      <img
        class="cursor-pointer rounded-full border-b"
        [ngSrc]="avatarUrl()"
        [width]="32"
        [height]="32"
        alt="Profile image"
      />
    </a>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Nav {
  private readonly auth = inject(Auth);
  private readonly sidebar = inject(Sidebar);
  private readonly size = inject(ScreenSize);

  avatarUrl = computed(() => this.auth.user()?.image ?? 'profile_placeholder.png');

  toggleSideNav() {
    this.sidebar.toggle();
  }

  clickLogo() {
    if (this.size.isMobile()) {
      this.sidebar.close();
    }
  }
}
