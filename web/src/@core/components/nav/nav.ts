import { NgOptimizedImage } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Logo } from '@core/components/logo/logo';
import { Auth } from '@core/services/auth/auth';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideLogOut,
  lucideUpload,
  lucideMoon,
  lucideSettings,
  lucideSearch,
} from '@ng-icons/lucide';
import { BrnPopover, BrnPopoverContent, BrnPopoverTrigger } from '@spartan-ng/brain/popover';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmPopoverClose, HlmPopoverContent } from '@spartan-ng/helm/popover';
import { Theme } from '@core/services/theme/theme';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-nav',
  providers: [
    provideIcons({ lucideLogOut, lucideUpload, lucideMoon, lucideSettings, lucideSearch }),
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
    <a routerLink="/gallery">
      <app-logo [size]="32" />
    </a>

    <div
      class="bg-muted/30 hover:bg-muted/50 flex h-12 w-full max-w-md items-center rounded-full px-4 transition"
    >
      <ng-icon hlm name="lucideSearch" />
      <svg
        class="text-muted-foreground mr-2 h-5 w-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M21 21l-4.35-4.35M10 18a8 8 0 100-16 8 8 0 000 16z"
        />
      </svg>

      <!-- Input -->
      <input
        class="text-foreground placeholder-muted-foreground flex-1 border-0 bg-transparent text-sm outline-none"
        type="text"
        placeholder="Search your gallery"
      />
    </div>

    <button class="text-foreground ml-auto" hlmBtn variant="ghost" size="sm">
      <ng-icon hlm size="sm" name="lucideUpload" />
      Upload
    </button>

    <brn-popover [sideOffset]="8" class="size-8">
      <button brnPopoverTrigger>
        <img
          class="cursor-pointer rounded-full border-b"
          [ngSrc]="avatarUrl()"
          [width]="32"
          [height]="32"
          alt="Profile image"
        />
      </button>

      <div hlmPopoverContent class="right-4 flex w-80 flex-col gap-4" *brnPopoverContent="let ctx">
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

          <button
            class="text-foreground"
            hlmBtn
            variant="ghost"
            size="icon"
            (click)="ctx.close()"
            routerLink="/settings"
          >
            <ng-icon class="text-foreground" hlm name="lucideSettings" />
          </button>
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

        <button hlmBtn variant="outline" size="sm" (click)="logOut()">
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

  avatarUrl = computed(() => this.auth.user()?.image ?? 'profile_placeholder.png');
  email = computed(() => this.auth.user()?.email);

  async logOut() {
    await this.auth.signOut();
  }

  toggleTheme() {
    this.theme.toggle();
  }
}
