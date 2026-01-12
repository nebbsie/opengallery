import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BlurhashCanvas } from '@core/components/blurhash-canvas/blurhash-canvas';
import { environment } from '@env/environment';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCirclePause, lucideCirclePlay } from '@ng-icons/lucide';
import { HlmIcon } from '@spartan-ng/helm/icon';

@Component({
  selector: 'app-asset-thumbnail',
  imports: [HlmIcon, NgIcon, RouterLink, BlurhashCanvas],
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
    <a [routerLink]="['/asset', _asset.id]" [queryParams]="queryParams()">
      @if (_asset.blurhash && !imageLoaded()) {
        <app-blurhash-canvas
          class="absolute inset-0 h-full w-full"
          [blurhash]="_asset.blurhash"
          [width]="32"
          [height]="32"
        />
      }
      <img
        class="absolute inset-0 h-full w-full object-cover"
        [class.opacity-0]="!imageLoaded()"
        [src]="apiUrl + '/asset/' + _asset.id + '/thumbnail'"
        [alt]="_asset.id"
        width="400"
        height="400"
        loading="lazy"
        decoding="async"
        (load)="onImageLoad()"
      />

      @if (_asset.type === 'video') {
        <div
          class="absolute top-2 right-2 grid h-8 w-8 place-items-center rounded-full bg-black/60 shadow-md backdrop-blur-sm"
        >
          <ng-icon class="h-4 w-4 text-white drop-shadow-md" hlm name="lucideCirclePlay" />
        </div>
      }
    </a>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssetThumbnail {
  protected readonly apiUrl = environment.api.url;
  protected readonly imageLoaded = signal(false);

  asset = input.required<{ type: 'image' | 'video'; id: string; blurhash?: string | null }>();
  from = input<string>();
  albumId = input<string>();
  cameraMake = input<string>();
  cameraModel = input<string>();

  protected queryParams = () => {
    const params: Record<string, string | undefined> = {
      from: this.from(),
      albumId: this.albumId(),
      cameraMake: this.cameraMake(),
      cameraModel: this.cameraModel(),
    };
    // Filter out undefined values
    return Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined));
  };

  onImageLoad(): void {
    this.imageLoaded.set(true);
  }
}
