import { ChangeDetectionStrategy, Component, computed, input, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { environment } from '@env/environment';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCheck, lucideImages, lucideSearch } from '@ng-icons/lucide';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { injectQuery } from '@tanstack/angular-query-experimental';

type PickerAlbum = { id: string; name: string; cover: string | null; items: number | null };

// Grid of the admin's top-level albums with covers. Picking an album also
// shares the albums inside it. Albums that are already picked but are not
// top-level (passed in as `known`) are kept and shown first, so a save never
// drops them by accident.
@Component({
  selector: 'app-album-picker',
  imports: [FormsModule, HlmInput, HlmSpinner, NgIcon, HlmIcon],
  providers: [provideIcons({ lucideCheck, lucideImages, lucideSearch })],
  host: { class: 'block' },
  template: `
    @if (albums.isPending()) {
      <div class="flex justify-center py-6"><hlm-spinner /></div>
    } @else if (list().length === 0) {
      <p class="text-muted-foreground rounded-lg border p-4 text-sm">You have no albums yet.</p>
    } @else {
      <div class="mb-2 flex items-center gap-2">
        <div class="relative flex-1">
          <ng-icon
            hlm
            size="sm"
            name="lucideSearch"
            class="text-muted-foreground absolute top-1/2 left-2.5 -translate-y-1/2"
          />
          <input
            hlmInput
            class="h-9 w-full pl-8"
            placeholder="Search albums"
            [ngModel]="query()"
            (ngModelChange)="query.set($event)"
          />
        </div>
        <span class="text-muted-foreground shrink-0 text-xs">{{ selected().length }} picked</span>
      </div>

      <div class="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4">
        @for (album of filtered(); track album.id) {
          <button
            type="button"
            class="group relative flex flex-col overflow-hidden rounded-lg border text-left transition-colors"
            [class.border-primary]="isSelected(album.id)"
            [class.ring-2]="isSelected(album.id)"
            [class.ring-primary]="isSelected(album.id)"
            [attr.aria-pressed]="isSelected(album.id)"
            (click)="toggle(album.id)"
          >
            <div class="bg-muted relative aspect-square w-full">
              @if (album.cover) {
                <img
                  class="h-full w-full object-cover"
                  [src]="apiUrl + '/asset/' + album.cover + '/thumbnail'"
                  [alt]="album.name"
                  loading="lazy"
                />
              } @else {
                <div class="text-muted-foreground grid h-full w-full place-items-center">
                  <ng-icon hlm size="lg" name="lucideImages" />
                </div>
              }
              @if (isSelected(album.id)) {
                <span
                  class="bg-primary text-primary-foreground absolute top-1 right-1 grid h-5 w-5 place-items-center rounded-full"
                >
                  <ng-icon hlm size="xs" name="lucideCheck" />
                </span>
              }
            </div>
            <div class="p-1.5">
              <p class="truncate text-xs font-medium">{{ album.name }}</p>
              @if (album.items !== null) {
                <p class="text-muted-foreground text-[10px]">{{ album.items }} items</p>
              }
            </div>
          </button>
        } @empty {
          <p class="text-muted-foreground col-span-full py-4 text-center text-sm">
            No albums match "{{ query() }}".
          </p>
        }
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlbumPicker {
  private readonly trpc = injectTrpc();
  protected readonly apiUrl = environment.api.url;

  /** Picked album ids. */
  readonly selected = model.required<string[]>();
  /** Albums already picked that may not be in the top-level list. */
  readonly known = input<{ id: string; name: string }[]>([]);

  protected readonly query = signal('');

  // Same key and source as the Albums page, so the cache is shared.
  protected readonly albums = injectQuery(() => ({
    queryKey: [CacheKey.AlbumsAll],
    queryFn: async () => this.trpc.album.getUsersAlbums.query(),
  }));

  protected readonly list = computed<PickerAlbum[]>(() => {
    const roots: PickerAlbum[] = (this.albums.data() ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      cover: a.cover,
      items: a.items,
    }));
    const rootIds = new Set(roots.map((a) => a.id));
    const extra = this.known()
      .filter((a) => !rootIds.has(a.id))
      .map((a) => ({ id: a.id, name: a.name, cover: null, items: null }));
    return [...extra, ...roots.sort((a, b) => a.name.localeCompare(b.name))];
  });

  protected readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return this.list();
    return this.list().filter((a) => a.name.toLowerCase().includes(q));
  });

  private readonly selectedSet = computed(() => new Set(this.selected()));

  protected isSelected(id: string) {
    return this.selectedSet().has(id);
  }

  protected toggle(id: string) {
    const next = new Set(this.selected());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.selected.set([...next]);
  }
}
