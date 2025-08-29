import { ChangeDetectionStrategy, Component } from '@angular/core';
import { environment } from '@env/environment';
import { injectTrpc } from '@core/services/trpc';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { CacheKey } from '@core/services/cache-key.types';
import { ErrorAlert } from '@core/components/error/error';
import { HlmSpinner } from '@spartan-ng/helm/spinner';

@Component({
  selector: 'app-album-all',
  imports: [ErrorAlert, HlmSpinner],
  template: `
    @if (albums.isPending()) {
      <hlm-spinner />
    }

    @if (albums.isError()) {
      <app-error-alert [error]="albums.error()" />
    }
    @if (albums.isSuccess()) {
      <div class="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
        @for (album of albums.data(); track album.id) {
          <div class="flex w-full flex-col">
            <img
              src="https://placehold.co/200x200"
              alt="Album cover"
              class="mb-2 h-full w-full rounded-lg object-cover"
            />
            <p>{{ album.name }}</p>
          </div>
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

  albums = injectQuery(() => ({
    queryKey: [CacheKey.AlbumsAll],
    queryFn: async () => this.trpc.album.getUsersAlbums.query(),
  }));
}
