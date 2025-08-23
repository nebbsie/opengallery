import { DatePipe, JsonPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { ErrorAlert } from '@core/components/error/error';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { environment } from '@env/environment';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { Media } from '../../types/media';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { lucidePlay } from '@ng-icons/lucide';

@Component({
  selector: 'app-gallery-all',
  providers: [provideIcons({ lucidePlay })],
  imports: [DatePipe, HlmSpinner, ErrorAlert, JsonPipe, NgIcon, HlmIcon],
  template: `
    @if (files.isPending()) {
      <hlm-spinner />
    }

    @if (files.isError()) {
      <app-error-alert [error]="files.error()" />
    }
    @if (files.isSuccess()) {
      <div class="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
        @for (asset of files.data(); track asset.id) {
          <div class="relative aspect-square overflow-hidden rounded-lg bg-black">
            @if (asset.type === 'image') {
              <img
                [src]="apiUrl + '/asset/' + asset.id"
                [alt]="asset.id"
                loading="lazy"
                decoding="async"
                class="absolute inset-0 h-full w-full object-cover"
              />
            } @else if (asset.type === 'video') {
              <video
                [src]="apiUrl + '/asset/' + asset.id"
                preload="metadata"
                muted
                playsInline
                class="pointer-events-none absolute inset-0 h-full w-full object-cover"
              ></video>

              <ng-icon
                hlm
                name="lucidePlay"
                class="absolute top-2 right-2 h-6 w-6 drop-shadow-md"
              ></ng-icon>
            }
          </div>
        }
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GalleryAll {
  protected readonly apiUrl = environment.api.url;

  private readonly trpc = injectTrpc();

  files = injectQuery(() => ({
    queryKey: [CacheKey.GalleryAll],
    queryFn: async () => this.trpc.files.getAllFiles.query(),
  }));
}
