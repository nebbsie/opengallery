import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { PrefetchRouteDirective } from '@core/directives/prefetch-route/prefetch-route.directive';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCalendar,
  lucideCamera,
  lucideFilm,
  lucideImage,
  lucideImages,
  lucideLayoutDashboard,
  lucideMap,
  lucideSearch,
  lucideUpload,
  lucideUsers,
} from '@ng-icons/lucide';
import { BrnTooltipImports } from '@spartan-ng/brain/tooltip';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmTooltipImports } from '@spartan-ng/helm/tooltip';
import { Auth } from '@core/services/auth/auth';
import { UploadService } from '@core/services/upload/upload';
import { SearchState } from '../../../../app/search/search-state';

type NavItem = { path: string; label: string; icon: string; exact?: boolean };

@Component({
  selector: 'app-side-nav-default',
  imports: [
    NgTemplateOutlet,
    HlmButton,
    HlmIcon,
    NgIcon,
    PrefetchRouteDirective,
    RouterLink,
    RouterLinkActive,
    HlmTooltipImports,
    BrnTooltipImports,
  ],
  providers: [
    provideIcons({
      lucideCalendar,
      lucideCamera,
      lucideFilm,
      lucideImage,
      lucideImages,
      lucideLayoutDashboard,
      lucideMap,
      lucideSearch,
      lucideUpload,
      lucideUsers,
    }),
  ],
  host: {
    class: 'flex flex-col gap-1',
  },
  template: `
    <hlm-tooltip>
      <button
        type="button"
        hlmTooltipTrigger
        position="right"
        hlmBtn
        size="icon"
        variant="menu"
        aria-label="Search"
        aria-keyshortcuts="/"
        (click)="openSearch()"
      >
        <ng-icon hlm size="sm" name="lucideSearch" />
      </button>
      <span *brnTooltipContent class="flex items-center gap-2">
        Search <kbd class="rounded bg-black/10 px-1 font-sans text-xs dark:bg-white/15">/</kbd>
      </span>
    </hlm-tooltip>

    @if (canUpload()) {
      <hlm-tooltip>
        <button
          type="button"
          hlmTooltipTrigger
          position="right"
          hlmBtn
          size="icon"
          variant="menu"
          aria-label="Upload"
          (click)="openUpload()"
        >
          <ng-icon hlm size="sm" name="lucideUpload" />
        </button>
        <span *brnTooltipContent class="flex items-center">Upload</span>
      </hlm-tooltip>
    }

    <hr class="my-2" />

    @for (item of primary; track item.path) {
      <ng-container *ngTemplateOutlet="link; context: { $implicit: item }" />
    }

    <hr class="my-2" />

    @for (item of secondary; track item.path) {
      <ng-container *ngTemplateOutlet="link; context: { $implicit: item }" />
    }

    <ng-template #link let-item>
      <hlm-tooltip>
        <a
          hlmTooltipTrigger
          position="right"
          hlmBtn
          size="icon"
          flPrefetchRoute
          [routerLink]="item.path"
          routerLinkActive="active"
          #rla="routerLinkActive"
          [routerLinkActiveOptions]="{ exact: !!item.exact }"
          [variant]="rla.isActive ? 'menu_active' : 'menu'"
          [attr.aria-label]="item.label"
          [attr.aria-current]="rla.isActive ? 'page' : null"
          (click)="handleClicked()"
        >
          <ng-icon hlm size="sm" [name]="item.icon" />
        </a>
        <span *brnTooltipContent class="flex items-center">{{ item.label }}</span>
      </hlm-tooltip>
    </ng-template>
  `,

  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SideNavDefault {
  private readonly search = inject(SearchState);
  private readonly uploads = inject(UploadService);
  private readonly auth = inject(Auth);
  // "View as" is read-only, so no uploads there.
  protected readonly canUpload = computed(() => !this.auth.viewAs());
  clicked = output<void>();

  protected readonly primary: NavItem[] = [
    { path: '/gallery', label: 'All', icon: 'lucideLayoutDashboard', exact: true },
    { path: '/gallery/photos', label: 'Photos', icon: 'lucideImage' },
    { path: '/gallery/videos', label: 'Videos', icon: 'lucideFilm' },
  ];

  protected readonly secondary: NavItem[] = [
    { path: '/faces', label: 'People', icon: 'lucideUsers' },
    { path: '/albums', label: 'Albums', icon: 'lucideImages' },
    { path: '/years', label: 'Years', icon: 'lucideCalendar' },
    { path: '/cameras', label: 'Cameras', icon: 'lucideCamera' },
    { path: '/map', label: 'World Map', icon: 'lucideMap' },
  ];

  openUpload() {
    this.uploads.openPicker();
    this.clicked.emit();
  }

  openSearch() {
    this.search.openPalette();
    this.clicked.emit();
  }

  handleClicked() {
    this.clicked.emit();
  }
}
