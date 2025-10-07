import { ChangeDetectionStrategy, Component, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { injectQuery } from '@tanstack/angular-query-experimental';

@Component({
  selector: 'app-side-nav-default',
  imports: [HlmButton, HlmIcon, NgIcon, RouterLink, RouterLinkActive],
  host: {
    class: 'flex flex-col w-full',
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

    <hr class="my-2" />

    <div class="flex items-center justify-between">
      <p class="font-medium">Albums</p>
      <a class="text-xs text-blue-500" size="sm" hlmBtn variant="link" routerLink="/albums"
        >View All</a
      >
    </div>

    @if (albums.isSuccess()) {
      @for (album of albums.data().slice(0, 5); track album.id) {
        <a
          class="mb-1"
          hlmBtn
          variant="menu"
          routerLinkActive="active"
          #rlaAlbum="routerLinkActive"
          [variant]="rlaAlbum.isActive ? 'menu_active' : 'menu'"
          [routerLink]="'/albums/' + album.id"
          (click)="handleClicked()"
        >
          <ng-icon hlm size="sm" name="lucideImages" />
          {{ album.name }}
        </a>
      }
    }

    <hr class="my-2" />

    <div class="flex items-center justify-between">
      <p class="font-medium">Folders</p>
      <a class="text-xs text-blue-500" size="sm" hlmBtn variant="link" routerLink="/folders"
        >View All</a
      >
    </div>
  `,

  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SideNavDefault {
  clicked = output<void>();

  private readonly trpc = injectTrpc();

  albums = injectQuery(() => ({
    queryKey: [CacheKey.AlbumsAll, 'with-children'],
    queryFn: async () => this.trpc.album.getAllUserAlbums.query(),
  }));

  handleClicked() {
    this.clicked.emit();
  }
}
