import { ChangeDetectionStrategy, Component, output } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { NgIcon } from '@ng-icons/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-side-nav-default',
  imports: [HlmButton, HlmIcon, NgIcon, RouterLink, RouterLinkActive],
  host: {
    class: 'flex flex-col w-full ',
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
      hlmBtn
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

    <a class="mb-1" hlmBtn variant="menu">
      <ng-icon hlm size="sm" name="lucideImages" />
      Birthdays
    </a>
    <a class="mb-1" hlmBtn variant="menu">
      <ng-icon hlm size="sm" name="lucideImages" />
      Christmas
    </a>
    <a class="mb-1" hlmBtn variant="menu">
      <ng-icon hlm size="sm" name="lucideImages" />
      Holidays
    </a>
  `,

  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SideNavDefault {
  clicked = output<void>();

  handleClicked() {
    this.clicked.emit();
  }
}
