import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { environment } from '@env/environment';
import { injectTrpc } from '@core/services/trpc';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { CacheKey } from '@core/services/cache-key.types';
import { ErrorAlert } from '@core/components/error/error';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { NgOptimizedImage } from '@angular/common';
import { lucideCirclePause, lucideCirclePlay } from '@ng-icons/lucide';

@Component({
  selector: 'app-gallery-videos',
  providers: [
    provideIcons({
      lucideCirclePlay,
      lucideCirclePause,
    }),
  ],
  imports: [ErrorAlert, HlmIcon, HlmSpinner, NgIcon],
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
            @if (asset.type === 'video') {
              <video
                [src]="apiUrl + '/asset/' + asset.id"
                preload="metadata"
                muted
                playsInline
                class="absolute inset-0 h-full w-full object-cover"
                (mouseenter)="onVideoHover(video)"
                (mouseleave)="onVideoHoverOut(video)"
                #video
              ></video>

              <div
                class="absolute top-2 right-1 flex items-center gap-x-2 rounded-full px-2 py-1 dark:bg-black/30"
              >
                <p class="font-semibold">0:09</p>
                <ng-icon
                  hlm
                  [name]="videoHoverPlaying() ? 'lucideCirclePause' : 'lucideCirclePlay'"
                  color="white"
                  class="!block h-6 w-6 drop-shadow-md"
                ></ng-icon>
              </div>
            }
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
export class GalleryVideos {
  protected readonly apiUrl = environment.api.url;

  private readonly trpc = injectTrpc();

  files = injectQuery(() => ({
    queryKey: [CacheKey.GalleryVideos],
    queryFn: async () => this.trpc.files.getUsersFiles.query('video'),
  }));

  videoHoverPlaying = signal<boolean>(false);

  onVideoHover(video: HTMLVideoElement) {
    video.play();
    this.videoHoverPlaying.set(true);
  }

  onVideoHoverOut(video: HTMLVideoElement) {
    video.pause();
    video.currentTime = 0; // Reset to beginning
    this.videoHoverPlaying.set(false);
  }
}
