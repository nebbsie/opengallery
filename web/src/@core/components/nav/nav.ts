import { NgOptimizedImage } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Logo } from '@core/components/logo/logo';
import { Auth } from '@core/services/auth/auth';
import { ScreenSize } from '@core/services/screen-size/screen-size';
import { Sidebar } from '@core/services/sidebar/sidebar';
import { Theme } from '@core/services/theme/theme';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCrown,
  lucideLogOut,
  lucideMenu,
  lucideMoon,
  lucideSearch,
  lucideSettings,
  lucideSun,
  lucideUpload,
} from '@ng-icons/lucide';
import { BrnPopover, BrnPopoverContent, BrnPopoverTrigger } from '@spartan-ng/brain/popover';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmPopoverContent } from '@spartan-ng/helm/popover';

@Component({
  selector: 'app-nav',
  providers: [
    provideIcons({
      lucideLogOut,
      lucideUpload,
      lucideMoon,
      lucideSettings,
      lucideSearch,
      lucideMenu,
      lucideCrown,
      lucideSun,
    }),
  ],
  imports: [
    BrnPopover,
    BrnPopoverTrigger,
    NgOptimizedImage,
    HlmPopoverContent,
    BrnPopoverContent,
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

    <brn-popover class="size-8" [sideOffset]="8">
      <button brnPopoverTrigger>
        <img
          class="cursor-pointer rounded-full border-b"
          [ngSrc]="avatarUrl()"
          [width]="32"
          [height]="32"
          alt="Profile image"
        />
      </button>

      <div class="right-4 flex w-80 flex-col gap-4" *brnPopoverContent="let ctx" hlmPopoverContent>
        <div class="flex justify-between">
          <button
            hlmBtn
            variant="ghost"
            size="icon"
            class="relative flex items-center justify-center"
            (click)="toggleTheme()"
          >
            <ng-icon
              hlm
              name="lucideMoon"
              class="text-foreground absolute transform transition-all duration-200 ease-in-out"
              [class.opacity-100]="theme.get() === 'light'"
              [class.opacity-0]="theme.get() === 'dark'"
              [class.scale-100]="theme.get() === 'light'"
              [class.scale-75]="theme.get() === 'dark'"
              [class.rotate-0]="theme.get() === 'light'"
              [class.rotate-180]="theme.get() === 'dark'"
            />

            <ng-icon
              hlm
              name="lucideSun"
              class="text-foreground absolute transform transition-all duration-200 ease-in-out"
              [class.opacity-100]="theme.get() === 'dark'"
              [class.opacity-0]="theme.get() === 'light'"
              [class.scale-100]="theme.get() === 'dark'"
              [class.scale-75]="theme.get() === 'light'"
              [class.rotate-0]="theme.get() === 'dark'"
              [class.-rotate-180]="theme.get() === 'light'"
            />
          </button>

          @if (type() === 'admin') {
            <a
              class="text-foreground"
              hlmBtn
              variant="ghost"
              size="icon"
              routerLink="/settings"
              (click)="ctx.close()"
            >
              <ng-icon class="text-foreground" hlm name="lucideSettings" />
            </a>
          }
        </div>

        <div class="flex flex-col items-center justify-center gap-2">
          <img
            class="rounded-full border-b"
            [ngSrc]="avatarUrl()"
            [width]="64"
            [height]="64"
            alt="Profile image"
          />
          <p class="text-muted-foreground flex items-center gap-2 text-sm">
            {{ email() }}

            @if (type() === 'admin') {
              <span
                class="flex items-center rounded-full bg-blue-500 p-1 text-white dark:bg-blue-600"
              >
                <ng-icon name="lucideCrown" />
              </span>
            }
          </p>
        </div>

        <button (click)="logOut()" hlmBtn variant="outline" size="sm">
          <ng-icon hlm size="sm" name="lucideLogOut" />
          Sign Out
        </button>
      </div>
    </brn-popover>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Nav {
  private readonly auth = inject(Auth);
  protected readonly theme = inject(Theme);
  private readonly sidebar = inject(Sidebar);
  private readonly size = inject(ScreenSize);

  avatarUrl = computed(() => this.auth.user()?.image ?? 'profile_placeholder.png');
  email = computed(() => this.auth.user()?.email);
  type = computed(() => this.auth.user()?.type);

  logOut() {
    this.auth.signOut();
  }

  toggleTheme() {
    this.theme.toggle();
  }

  toggleSideNav() {
    this.sidebar.toggle();
  }

  clickLogo() {
    if (this.size.isMobile()) {
      this.sidebar.close();
    }
  }
}
