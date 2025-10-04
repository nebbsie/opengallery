import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { environment } from '@env/environment';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideImages } from '@ng-icons/lucide';
import { HlmIcon } from '@spartan-ng/helm/icon';

@Component({
  selector: 'app-album-thumbnail',
  imports: [RouterLink, HlmIcon, NgIcon],
  providers: [provideIcons({ lucideImages })],
  template: `
    @let _album = album();
    <a class="flex w-full cursor-pointer flex-col gap-1" [routerLink]="'/albums/' + _album.id">
      @if (_album.cover) {
        <img
          [src]="apiUrl + '/asset/' + _album.cover + '/thumbnail'"
          alt="Album cover"
          class="h-full w-full rounded-lg object-cover"
        />
      } @else {
        <div
          class="relative aspect-square w-full rounded-lg bg-[var(--secondary)] ring-1 ring-[var(--border)]"
        >
          <div class="absolute inset-0 grid place-items-center">
            <div class="flex items-center justify-center rounded-full bg-[var(--muted)] p-4">
              <ng-icon hlm name="lucideImages" class="size-10 text-[var(--muted-foreground)]" />
            </div>
          </div>
        </div>
      }

      <div class="flex flex-col px-2">
        <p class="line-clamp-2 text-sm font-bold break-all">
          {{ _album.name }}
        </p>
        <p class="text-xs font-light">{{ _album.items ?? 0 }} items</p>
      </div>
    </a>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlbumThumbnail {
  protected readonly apiUrl = environment.api.url;

  album = input.required<{ cover: string | null; id: string; name: string; items?: number }>();
}
