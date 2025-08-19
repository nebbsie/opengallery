import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCamera, lucideFilm, lucideImages, lucideLayoutDashboard } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { ScreenSize } from '@core/services/screen-size/screen-size';

@Component({
  selector: 'app-side-nav',
  imports: [HlmButton, NgIcon, HlmIcon, RouterLink, RouterLinkActive],
  providers: [provideIcons({ lucideFilm, lucideCamera, lucideLayoutDashboard, lucideImages })],
  host: {
    class: 'flex flex-col w-full sm:w-[250px] h-full border-r p-4',
  },
  template: `
    <p class="mb-2 font-medium">Gallery</p>

    <a
      class="mb-1"
      hlmBtn
      routerLink="/gallery"
      routerLinkActive="active"
      #rlaAll="routerLinkActive"
      [variant]="rlaAll.isActive ? 'menu_active' : 'menu'"
      [routerLinkActiveOptions]="{ exact: true }"
      (click)="handleClicked()"
    >
      <ng-icon hlm size="sm" name="lucideLayoutDashboard" />
      All
    </a>

    <a
      class="mb-1"
      hlmBtn
      routerLink="/gallery/photos"
      routerLinkActive="active"
      #rlaPhotos="routerLinkActive"
      [variant]="rlaPhotos.isActive ? 'menu_active' : 'menu'"
      (click)="handleClicked()"
    >
      <ng-icon hlm size="sm" name="lucideCamera" />
      Photos
    </a>

    <a
      class="mb-1"
      hlmBtn="asdasdas"
      routerLink="/gallery/videos"
      routerLinkActive="active"
      #rlaVideos="routerLinkActive"
      [variant]="rlaVideos.isActive ? 'menu_active' : 'menu'"
      (click)="handleClicked()"
    >
      <ng-icon hlm size="sm" name="lucideFilm" />
      Videos
    </a>

    <p class="mt-6 mb-2 font-medium">Albums</p>

    <button class="mb-1" hlmBtn variant="menu">
      <ng-icon hlm size="sm" name="lucideImages" />
      Birthdays
    </button>
    <button class="mb-1" hlmBtn variant="menu">
      <ng-icon hlm size="sm" name="lucideImages" />
      Christmas
    </button>
    <button class="mb-1" hlmBtn variant="menu">
      <ng-icon hlm size="sm" name="lucideImages" />
      Holidays
    </button>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SideNav {
  private readonly size = inject(ScreenSize);

  sideNavToggle = output<void>();

  handleClicked() {
    if (!this.size.isMobile()) {
      return;
    }

    this.sideNavToggle.emit();
  }
}
