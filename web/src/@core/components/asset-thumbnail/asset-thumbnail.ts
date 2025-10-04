import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { environment } from '@env/environment';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCirclePause, lucideCirclePlay } from '@ng-icons/lucide';
import { HlmIcon } from '@spartan-ng/helm/icon';

@Component({
  selector: 'app-asset-thumbnail',
  imports: [HlmIcon, NgIcon, RouterLink],
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
    <a [routerLink]="['/asset', _asset.id]" [queryParams]="{ from: from(), albumId: albumId() }">
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

        <div class="absolute top-2 right-2">
          <ng-icon class="size-6 drop-shadow" hlm name="lucideCirclePlay" color="white" />
        </div>
      }
    </a>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssetThumbnail {
  protected readonly apiUrl = environment.api.url;

  asset = input.required<{ type: 'image' | 'video'; id: string }>();
  from = input<string>();
  albumId = input<string>();
}
