import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import {
  HlmBreadcrumb,
  HlmBreadcrumbItem,
  HlmBreadcrumbLink,
  HlmBreadcrumbList,
  HlmBreadcrumbPage,
  HlmBreadcrumbSeparator,
} from '@spartan-ng/helm/breadcrumb';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucidePencil, lucidePlus } from '@ng-icons/lucide';

@Component({
  selector: 'app-album-toolbar',
  imports: [
    HlmBreadcrumb,
    HlmBreadcrumbItem,
    HlmBreadcrumbLink,
    HlmBreadcrumbList,
    HlmBreadcrumbPage,
    HlmBreadcrumbSeparator,
    HlmButton,
    HlmIcon,
    NgIcon,
  ],
  providers: [provideIcons({ lucidePencil, lucidePlus })],
  host: {
    class: 'flex mb-2 justify-between items-center',
  },
  template: `
    <nav hlmBreadcrumb>
      <ol hlmBreadcrumbList>
        <li hlmBreadcrumbItem>
          <a hlmBreadcrumbLink link="/albums">Albums</a>
        </li>

        @for (item of items(); track item.id; let last = $last) {
          <li class="flex items-center" hlmBreadcrumbSeparator></li>
          <li hlmBreadcrumbItem>
            @if (!last) {
              <a hlmBreadcrumbLink [link]="'/albums/' + item.id">{{ item.name }}</a>
            } @else {
              <span hlmBreadcrumbPage>{{ item.name }}</span>
            }
          </li>
        }
      </ol>
    </nav>

    <div class="flex items-center gap-2">
      <button hlmBtn size="icon" variant="ghost" class="size-8">
        <ng-icon hlm size="sm" name="lucidePlus" />
      </button>

      <button hlmBtn size="icon" variant="ghost" class="size-8">
        <ng-icon hlm size="sm" name="lucidePencil" />
      </button>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlbumToolbar {
  items = input.required<{ id: string; name: string }[]>();
}
