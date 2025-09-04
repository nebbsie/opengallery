import { ChangeDetectionStrategy, Component, computed, effect, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ErrorAlert } from '@core/components/error/error';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { AlbumToolbar } from '@core/components/album-toolbar/album-toolbar';
import { BrnSelectImports } from '@spartan-ng/brain/select';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

@Component({
  selector: 'app-album-all',
  imports: [
    ErrorAlert,
    HlmSpinner,
    RouterLink,
    AlbumToolbar,
    BrnSelectImports,
    HlmSelectImports,
    ReactiveFormsModule,
  ],

  template: `
    @if (albums.isPending()) {
      <hlm-spinner />
    }

    @if (albums.isError()) {
      <app-error-alert [error]="albums.error()" />
    }

    @if (albums.isSuccess()) {
      <div class="flex justify-end">
        <brn-select
          class="mb-4 inline-block"
          placeholder="Select a view"
          [formControl]="selectedView"
        >
          <hlm-select-trigger class="text-primary">
            <hlm-select-value />
          </hlm-select-trigger>
          <hlm-select-content class="w-56">
            <hlm-option value="folder">Folder View</hlm-option>
            <hlm-option value="album">Album View</hlm-option>
          </hlm-select-content>
        </brn-select>
      </div>

      <p class="text-primary">{{ selectedView.value }}</p>

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

  selectedView = new FormControl<'folder' | 'album'>('folder', { nonNullable: true });

  albums = injectQuery(() => ({
    queryKey: [CacheKey.AlbumsAll, this.selectedView.value],
    queryFn: async () => this.trpc.album.getUsersAlbums.query(this.selectedView.value),
  }));

  displayedAlbums = computed(() => this.albums.data() ?? []);
}
