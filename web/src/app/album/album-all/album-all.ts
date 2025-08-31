import { ChangeDetectionStrategy, Component } from '@angular/core';
import { environment } from '@env/environment';
import { injectTrpc } from '@core/services/trpc';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { CacheKey } from '@core/services/cache-key.types';
import { ErrorAlert } from '@core/components/error/error';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import {
  HlmBreadcrumb,
  HlmBreadcrumbItem,
  HlmBreadcrumbLink,
  HlmBreadcrumbList,
  HlmBreadcrumbSeparator,
} from '@spartan-ng/helm/breadcrumb';
import { HlmButton } from '@spartan-ng/helm/button';

interface AlbumNode {
  id: string;
  name: string;
  desc: string | null;
  cover: string | null;
  parentId: string | null;
  libraryId: string;
  dir: string;
  createdAt: Date;
  updatedAt: Date;
}

@Component({
  selector: 'app-album-all',
  imports: [
    ErrorAlert,
    HlmSpinner,
    HlmBreadcrumb,
    HlmBreadcrumbList,
    HlmBreadcrumbItem,
    HlmBreadcrumbSeparator,
    HlmButton,
  ],
  template: `
    @if (albums.isPending()) {
      <hlm-spinner />
    }

    @if (albums.isError()) {
      <app-error-alert [error]="albums.error()" />
    }
    @if (albums.isSuccess()) {
      @if (currentParentId) {
        <button hlmBtn variant="ghost" class="mb-4" (click)="goBack()">← Back</button>
      }

      @if (breadcrumb.length) {
        <nav hlmBreadcrumb class="mb-2">
          <ol hlmBreadcrumbList>
            @for (crumb of breadcrumb; track crumb.id; let isLast = $last) {
              <li hlmBreadcrumbItem class="flex items-center">
                <span>{{ crumb.name }}</span>
              </li>
              @if (!isLast) {
                <li hlmBreadcrumbSeparator class="flex items-center"></li>
              }
            }
          </ol>
        </nav>
      }

      <div class="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
        @for (album of displayedAlbums; track album.id) {
          <a class="flex w-full cursor-pointer flex-col" (click)="openAlbum(album.id)">
            <img
              [src]="album.cover || 'https://placehold.co/200x200'"
              alt="Album cover"
              class="mb-2 h-full w-full rounded-lg object-cover"
            />
            <p>{{ album.name }}</p>
          </a>
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlbumAll {
  protected readonly apiUrl = environment.api.url;

  private readonly trpc = injectTrpc();

  // Holds current parentId to filter children
  currentParentId: string | null = null;

  albums = injectQuery(() => ({
    queryKey: [CacheKey.AlbumsAll],
    queryFn: async () => this.trpc.album.getUsersAlbums.query(),
  }));

  // Albums filtered by current parentId
  get displayedAlbums(): AlbumNode[] {
    return this.albums.data()?.filter((a) => a.parentId === this.currentParentId) ?? [];
  }

  // Breadcrumb path for navigation display
  get breadcrumb(): AlbumNode[] {
    const crumbs: AlbumNode[] = [];
    let parentId = this.currentParentId;
    const flatAlbums = this.albums.data() ?? [];

    while (parentId) {
      const parent = flatAlbums.find((a) => a.id === parentId);
      if (!parent) break;
      crumbs.unshift(parent);
      parentId = parent.parentId;
    }

    return crumbs;
  }

  openAlbum(albumId: string) {
    this.currentParentId = albumId;
  }

  goBack() {
    const flatAlbums = this.albums.data() ?? [];
    const current = flatAlbums.find((a) => a.id === this.currentParentId);
    this.currentParentId = current?.parentId ?? null;
  }
}
