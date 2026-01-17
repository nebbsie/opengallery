import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { SideNavDefault } from '@core/components/side-nav/side-nav-default/side-nav-default';
import { SideNavSettings } from '@core/components/side-nav/side-nav-settings/side-nav-settings';
import { Sidebar } from '@core/services/sidebar/sidebar';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCamera,
  lucideFilm,
  lucideImages,
  lucideLayoutDashboard,
  lucideSettings,
  lucideChevronLeft,
  lucideMenu,
} from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { RouterLink } from '@angular/router';
import { Logo } from '@core/components/logo/logo';
import { HlmTooltipImports } from '@spartan-ng/helm/tooltip';
import { BrnTooltipImports } from '@spartan-ng/brain/tooltip';

@Component({
  selector: 'app-side-nav',
  imports: [
    SideNavDefault,
    SideNavSettings,
    HlmButton,
    HlmIcon,
    NgIcon,
    RouterLink,
    Logo,
    HlmTooltipImports,
    BrnTooltipImports,
  ],
  providers: [
    provideIcons({
      lucideFilm,
      lucideCamera,
      lucideLayoutDashboard,
      lucideImages,
      lucideSettings,
      lucideChevronLeft,
      lucideMenu,
    }),
  ],
  host: {
    class:
      'flex flex-col w-full h-full border-r items-center overflow-hidden max-w-[50px] sm:max-w-[64px]',
  },
  template: `
    <div class="flex items-center justify-center p-3 pt-4">
      <a routerLink="/">
        <app-logo [size]="20" />
      </a>
    </div>

    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
      @switch (sideBarType()) {
        @case ('settings') {
          <app-side-nav-settings />
          <hlm-tooltip>
            <a
              class="mt-auto"
              hlmBtn
              hlmTooltipTrigger
              position="right"
              size="icon"
              routerLink="/"
              [variant]="'menu'"
            >
              <ng-icon hlm size="sm" name="lucideChevronLeft" />
            </a>

            <span *brnTooltipContent class="flex items-center"> Back </span>
          </hlm-tooltip>
        }
        @default {
          <app-side-nav-default />

          <hlm-tooltip>
            <a
              class="mt-auto"
              hlmTooltipTrigger
              hlmBtn
              position="right"
              size="icon"
              routerLink="/settings"
              [variant]="'menu'"
            >
              <ng-icon hlm size="sm" name="lucideSettings" />
            </a>

            <span *brnTooltipContent class="flex items-center"> Settings </span>
          </hlm-tooltip>
        }
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SideNav {
  private readonly sidebar = inject(Sidebar);

  sideBarType = this.sidebar.content;
}
