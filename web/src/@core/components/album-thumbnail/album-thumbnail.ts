import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { environment } from '@env/environment';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideImages, lucideLoader } from '@ng-icons/lucide';
import { HlmIcon } from '@spartan-ng/helm/icon';

@Component({
  selector: 'app-album-thumbnail',
  imports: [RouterLink, HlmIcon, NgIcon],
  providers: [provideIcons({ lucideImages, lucideLoader })],
  template: `
    @let _album = album();
    <a class="group flex w-full cursor-pointer flex-col gap-2" [routerLink]="'/albums/' + _album.id">
      <div
        class="ring-border/60 relative aspect-square w-full overflow-hidden rounded-xl shadow-sm ring-1 transition-all duration-300 group-hover:shadow-lg group-hover:ring-foreground/20"
      >
        @if (_album.cover) {
          <img
            [src]="apiUrl + '/asset/' + _album.cover + '/thumbnail'"
            alt="Album cover"
            class="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]"
          />
        } @else {
          <div
            class="grid h-full w-full place-items-center bg-gradient-to-br from-secondary to-muted"
          >
            <div class="bg-background/40 flex items-center justify-center rounded-full p-4 backdrop-blur-sm">
              <ng-icon hlm name="lucideImages" class="text-muted-foreground size-9" />
            </div>
          </div>
        }

        @if (_album.pendingTasks && _album.pendingTasks > 0) {
          <div
            class="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-black/70 px-2 py-1 text-xs text-white backdrop-blur-sm"
          >
            <ng-icon hlm name="lucideLoader" class="size-3 animate-spin" />
            <span>{{ _album.pendingTasks }}</span>
          </div>
        }
      </div>

      <div class="flex flex-col px-1">
        <p class="text-foreground line-clamp-2 text-sm font-semibold break-all">
          {{ _album.name }}
        </p>
        <p class="text-muted-foreground text-xs">{{ _album.items ?? 0 }} items</p>
      </div>
    </a>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlbumThumbnail {
  protected readonly apiUrl = environment.api.url;

  album = input.required<{
    cover: string | null;
    id: string;
    name: string;
    items?: number;
    pendingTasks?: number;
  }>();
}
