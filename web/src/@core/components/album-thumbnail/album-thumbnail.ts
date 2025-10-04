import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-album-thumbnail',
  imports: [RouterLink],
  template: `
    @let _album = album();
    <a class="flex w-full cursor-pointer flex-col gap-2" [routerLink]="'/albums/' + _album.id">
      <img
        [src]="_album.cover || 'https://placehold.co/200x200'"
        alt="Album cover"
        class="h-full w-full rounded-lg object-cover"
      />

      <p class="text-sm break-all">{{ _album.name }}</p>
    </a>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlbumThumbnail {
  album = input.required<{ cover: string | null; id: string; name: string }>();
}
