import { NgOptimizedImage } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  output,
} from '@angular/core';
import { RouterLink, Router, NavigationEnd } from '@angular/router';
import { Logo } from '@core/components/logo/logo';
import { Auth } from '@core/services/auth/auth';
import { Theme } from '@core/services/theme/theme';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideLogOut,
  lucideMoon,
  lucideSearch,
  lucideSettings,
  lucideUpload,
  lucideMenu,
} from '@ng-icons/lucide';
import { BrnPopover, BrnPopoverContent, BrnPopoverTrigger } from '@spartan-ng/brain/popover';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmPopoverContent } from '@spartan-ng/helm/popover';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { ScreenSize } from '@core/services/screen-size/screen-size';

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
    }),
  ],
  imports: [
    Logo,
    BrnPopover,
    BrnPopoverTrigger,
    NgOptimizedImage,
    HlmPopoverContent,
    BrnPopoverContent,
    HlmButton,
    NgIcon,
    HlmIcon,
    RouterLink,
  ],
  host: {
    class: 'flex w-full items-center border-b p-4 space-x-4',
  },
  template: `
    <button class="text-foreground" (click)="toggleSideNav()" hlmBtn variant="ghost" size="sm">
      <ng-icon hlm size="sm" name="lucideMenu" />
    </button>

    <a class="hidden sm:visible" routerLink="/gallery" (click)="toggleSideNav()">
      <app-logo [size]="32" />
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
            class="text-foreground"
            hlmBtn
            variant="ghost"
            size="icon"
            (click)="toggleTheme()"
          >
            <ng-icon class="text-foreground" hlm name="lucideMoon" />
          </button>

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
        </div>

        <div class="flex flex-col items-center justify-center gap-2">
          <img
            class="rounded-full border-b"
            [ngSrc]="avatarUrl()"
            [width]="64"
            [height]="64"
            alt="Profile image"
          />
          <p class="text-muted-foreground text-sm">{{ email() }}</p>
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
  private readonly theme = inject(Theme);
  private readonly size = inject(ScreenSize);

  sideNavToggle = output<void>();

  avatarUrl = computed(() => this.auth.user()?.image ?? 'profile_placeholder.png');
  email = computed(() => this.auth.user()?.email);

  logOut() {
    this.auth.signOut();
  }

  toggleTheme() {
    this.theme.toggle();
  }

  toggleSideNav() {
    this.sideNavToggle.emit();
  }
}
