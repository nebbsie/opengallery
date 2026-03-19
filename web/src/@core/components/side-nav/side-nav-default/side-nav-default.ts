import { ChangeDetectionStrategy, Component, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { PrefetchRouteDirective } from '@core/directives/prefetch-route/prefetch-route.directive';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { NgIcon } from '@ng-icons/core';
import { BrnTooltipImports } from '@spartan-ng/brain/tooltip';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmTooltipImports } from '@spartan-ng/helm/tooltip';
import { injectQuery } from '@tanstack/angular-query-experimental';

@Component({
  selector: 'app-side-nav-default',
  imports: [
    HlmButton,
    HlmIcon,
    NgIcon,
    PrefetchRouteDirective,
    RouterLink,
    RouterLinkActive,
    HlmTooltipImports,
    BrnTooltipImports,
  ],
  host: {
    class: 'flex flex-col gap-1',
  },
  template: `
    <hlm-tooltip>
      <a
        hlmTooltipTrigger
        position="right"
        hlmBtn
        routerLink="/gallery"
        flPrefetchRoute
        routerLinkActive="active"
        #rlaAll="routerLinkActive"
        size="icon"
        [variant]="rlaAll.isActive ? 'menu_active' : 'menu'"
        [routerLinkActiveOptions]="{ exact: true }"
        (click)="handleClicked()"
      >
        <ng-icon hlm size="sm" name="lucideLayoutDashboard" />
      </a>
      <span *brnTooltipContent class="flex items-center"> All </span>
    </hlm-tooltip>

    <hlm-tooltip>
      <a
        hlmTooltipTrigger
        position="right"
        hlmBtn
        routerLink="/gallery/photos"
        flPrefetchRoute
        routerLinkActive="active"
        size="icon"
        #rlaPhotos="routerLinkActive"
        [variant]="rlaPhotos.isActive ? 'menu_active' : 'menu'"
        (click)="handleClicked()"
      >
        <ng-icon hlm size="sm" name="lucideCamera" />
      </a>
      <span *brnTooltipContent class="flex items-center"> Photos </span>
    </hlm-tooltip>

    <hlm-tooltip>
      <a
        hlmTooltipTrigger
        position="right"
        hlmBtn
        routerLink="/gallery/videos"
        flPrefetchRoute
        routerLinkActive="active"
        size="icon"
        #rlaVideos="routerLinkActive"
        [variant]="rlaVideos.isActive ? 'menu_active' : 'menu'"
        (click)="handleClicked()"
      >
        <ng-icon hlm size="sm" name="lucideFilm" />
      </a>
      <span *brnTooltipContent class="flex items-center"> Videos </span>
    </hlm-tooltip>

    <hr class="my-2" />

    <hlm-tooltip>
      <a
        hlmTooltipTrigger
        position="right"
        hlmBtn
        routerLink="/cameras"
        flPrefetchRoute
        routerLinkActive="active"
        size="icon"
        #rlaCameras="routerLinkActive"
        [variant]="rlaCameras.isActive ? 'menu_active' : 'menu'"
        (click)="handleClicked()"
      >
        <ng-icon hlm size="sm" name="lucideCamera" />
      </a>
      <span *brnTooltipContent class="flex items-center"> Cameras </span>
    </hlm-tooltip>

    <hlm-tooltip>
      <a
        hlmTooltipTrigger
        position="right"
        hlmBtn
        routerLink="/albums"
        flPrefetchRoute
        routerLinkActive="active"
        size="icon"
        #rlaAlbums="routerLinkActive"
        [variant]="rlaAlbums.isActive ? 'menu_active' : 'menu'"
        (click)="handleClicked()"
      >
        <ng-icon hlm size="sm" name="lucideImages" />
      </a>
      <span *brnTooltipContent class="flex items-center"> Albums </span>
    </hlm-tooltip>

    <hlm-tooltip>
      <a
        hlmTooltipTrigger
        position="right"
        hlmBtn
        routerLink="/map"
        flPrefetchRoute
        routerLinkActive="active"
        size="icon"
        #rlaWorldMap="routerLinkActive"
        [variant]="rlaWorldMap.isActive ? 'menu_active' : 'menu'"
        (click)="handleClicked()"
      >
        <ng-icon hlm size="sm" name="lucideMap" />
      </a>
      <span *brnTooltipContent class="flex items-center"> World Map </span>
    </hlm-tooltip>
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
