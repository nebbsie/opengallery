import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmBreadCrumbImports } from '@spartan-ng/helm/breadcrumb';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucidePlus } from '@ng-icons/lucide';

@Component({
  selector: 'app-album-toolbar',
  imports: [HlmButton, HlmIcon, HlmBreadCrumbImports, NgIcon], // no RouterLink here
  host: { class: 'flex justify-between items-center w-full mb-4' },
  providers: [provideIcons({ lucidePlus })],
  template: `
    <nav class="flex items-center" hlmBreadcrumb>
      <ol hlmBreadcrumbList>
        @for (c of crumbs(); track c.key) {
          <li hlmBreadcrumbItem>
            @if (!c.last) {
              <a hlmBreadcrumbLink [link]="c.link">{{ c.label }}</a>
            } @else {
              <span hlmBreadcrumbPage>{{ c.label }}</span>
            }
          </li>
        }
      </ol>
    </nav>

    <div>
      <button hlmBtn variant="ghost">
        <ng-icon hlm size="sm" name="lucidePlus"></ng-icon>
        Add Album
      </button>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlbumToolbar {
  rootLink = input<string>('/albums'); // "/" crumb target
  encodedRoot = input<string | null>(null); // null on true root page
  segments = input<string[]>([]); // [] on true root page
  albumName = input<string | null>(null); // optional label override

  readonly crumbs = computed(() => {
    const segs = this.segments() ?? [];
    const base = [this.rootLink(), ...(this.encodedRoot() ? [this.encodedRoot() as string] : [])];

    const items = segs.map((s, i) => ({
      label: i === segs.length - 1 ? (this.albumName() ?? s) : s,
      link: [...base, ...segs.slice(0, i + 1)], // works with [link]
      last: i === segs.length - 1,
      key: `seg-${i}-${s}`,
    }));

    return [
      { label: '/', link: [this.rootLink()], last: items.length === 0, key: 'root' },
      ...items,
    ];
  });
}
