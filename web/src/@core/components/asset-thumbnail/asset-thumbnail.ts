import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { environment } from '@env/environment';
import { lucideCirclePause, lucideCirclePlay } from '@ng-icons/lucide';

@Component({
  selector: 'app-asset-thumbnail',
  imports: [HlmIcon, NgIcon],
  providers: [
    provideIcons({
      lucideCirclePlay,
      lucideCirclePause,
    }),
  ],
  host: {
    class: 'relative aspect-square overflow-hidden rounded-lg bg-black',
  },
  template: `
    @let _asset = asset();
    @if (_asset.type === 'image') {
      <img
        class="absolute inset-0 h-full w-full object-cover"
        [src]="apiUrl + '/asset/' + _asset.id + '/thumbnail'"
        [alt]="_asset.id"
        loading="lazy"
        decoding="async"
      />
    } @else if (_asset.type === 'video') {
      <video
        #video
        class="absolute inset-0 h-full w-full object-cover"
        [src]="apiUrl + '/asset/' + _asset.id"
        preload="metadata"
        muted
        playsInline
      ></video>

      <div
        class="absolute top-2 right-1 flex items-center gap-x-2 rounded-full px-2 py-1 dark:bg-black/30"
      >
        <p class="font-semibold">0:09</p>
        <ng-icon
          class="!block h-6 w-6 drop-shadow-md"
          hlm
          [name]="videoHoverPlaying() ? 'lucideCirclePause' : 'lucideCirclePlay'"
          color="white"
        />
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssetThumbnail {
  protected readonly apiUrl = environment.api.url;

  asset = input.required<{ type: 'image' | 'video'; id: string }>();

  videoHoverPlaying = signal<boolean>(false);
}
