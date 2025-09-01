import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ErrorAlert } from '@core/components/error/error';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { AlbumToolbar } from '@core/components/album-toolbar/album-toolbar';

@Component({
  selector: 'app-album-all',
  imports: [ErrorAlert, HlmSpinner, RouterLink, AlbumToolbar],

  template: `
    @if (albums.isPending()) {
      <hlm-spinner />
    }

    @if (albums.isError()) {
      <app-error-alert [error]="albums.error()" />
    }

    @if (albums.isSuccess()) {
      <div class="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
        @for (album of displayedAlbums(); track album.id) {
          <a class="flex w-full cursor-pointer flex-col" [routerLink]="'/albums/' + album.id">
            <img
              [src]="album.cover || 'https://placehold.co/200x200'"
              alt="Album cover"
              class="mb-2 h-full w-full rounded-lg object-cover"
            />
            <p class="break-all">{{ album.name }}</p>
          </a>
        }
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlbumAll {
  private readonly trpc = injectTrpc();

  albums = injectQuery(() => ({
    queryKey: [CacheKey.AlbumsAll],
    queryFn: async () => this.trpc.album.getUsersAlbums.query(),
  }));

  displayedAlbums = computed(() => this.albums.data() ?? []);
}
