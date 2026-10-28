import { ChangeDetectionStrategy, Component, computed, input, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { environment } from '@env/environment';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideEyeOff, lucideSearch, lucideUser, lucideX } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { injectQuery } from '@tanstack/angular-query-experimental';

export type PickerPerson = {
  id: string;
  name: string | null;
  coverFaceId: string | null;
  faceCount: number;
};

const PAGE = 48;

// Searchable grid of face avatars for "Hide people from them". Named people
// come first, then unnamed clusters (shown only as faces) by size. Picked
// people are listed above the grid so the admin always sees the result.
@Component({
  selector: 'app-people-picker',
  imports: [FormsModule, HlmButton, HlmInput, HlmSpinner, NgIcon, HlmIcon],
  providers: [provideIcons({ lucideEyeOff, lucideSearch, lucideUser, lucideX })],
  host: { class: 'block' },
  template: `
    @if (pickedPeople().length > 0) {
      <div class="mb-3 flex flex-wrap gap-2">
        @for (p of pickedPeople(); track p.id) {
          <button
            type="button"
            class="bg-muted hover:bg-accent flex items-center gap-1.5 rounded-full py-0.5 pr-2 pl-0.5 text-xs"
            [attr.aria-label]="'Stop hiding ' + label(p)"
            (click)="toggle(p.id)"
          >
            <span class="bg-background block h-6 w-6 overflow-hidden rounded-full">
              @if (p.coverFaceId) {
                <img class="h-full w-full object-cover" [src]="faceUrl(p.coverFaceId)" alt="" />
              }
            </span>
            {{ label(p) }}
            <ng-icon hlm size="xs" name="lucideX" />
          </button>
        }
      </div>
    }

    @if (people.isPending()) {
      <div class="flex justify-center py-6"><hlm-spinner /></div>
    } @else if (all().length === 0) {
      <p class="text-muted-foreground rounded-lg border p-4 text-sm">
        No people found yet. Faces show here after face detection runs.
      </p>
    } @else {
      <div class="relative mb-2">
        <ng-icon
          hlm
          size="sm"
          name="lucideSearch"
          class="text-muted-foreground absolute top-1/2 left-2.5 -translate-y-1/2"
        />
        <input
          hlmInput
          class="h-9 w-full pl-8"
          placeholder="Search people by name"
          [ngModel]="query()"
          (ngModelChange)="setQuery($event)"
        />
      </div>

      <div class="grid max-h-72 grid-cols-4 gap-2 overflow-y-auto pr-1 sm:grid-cols-6">
        @for (p of shown(); track p.id) {
          <button
            type="button"
            class="flex flex-col items-center gap-1 rounded-lg p-1 text-center"
            [attr.aria-pressed]="isSelected(p.id)"
            [attr.aria-label]="(isSelected(p.id) ? 'Stop hiding ' : 'Hide ') + label(p)"
            (click)="toggle(p.id)"
          >
            <span
              class="bg-muted relative block aspect-square w-full max-w-16 overflow-hidden rounded-full"
              [class.ring-2]="isSelected(p.id)"
              [class.ring-destructive]="isSelected(p.id)"
            >
              @if (p.coverFaceId) {
                <img
                  class="h-full w-full object-cover"
                  [class.opacity-40]="isSelected(p.id)"
                  [src]="faceUrl(p.coverFaceId)"
                  [alt]="label(p)"
                  loading="lazy"
                />
              } @else {
                <span class="text-muted-foreground grid h-full w-full place-items-center">
                  <ng-icon hlm size="sm" name="lucideUser" />
                </span>
              }
              @if (isSelected(p.id)) {
                <span class="text-destructive absolute inset-0 grid place-items-center">
                  <ng-icon hlm size="sm" name="lucideEyeOff" />
                </span>
              }
            </span>
            <span
              class="w-full truncate text-[11px]"
              [class.text-muted-foreground]="!p.name"
            >
              {{ p.name || p.faceCount + ' photos' }}
            </span>
          </button>
        } @empty {
          <p class="text-muted-foreground col-span-full py-4 text-center text-sm">
            Nobody named "{{ query() }}".
          </p>
        }
      </div>

      @if (filtered().length > shown().length) {
        <div class="mt-2 flex justify-center">
          <button hlmBtn variant="ghost" size="sm" type="button" (click)="showMore()">
            Show more faces
          </button>
        </div>
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PeoplePicker {
  private readonly trpc = injectTrpc();
  private readonly apiUrl = environment.api.url;

  /** Picked person ids. */
  readonly selected = model.required<string[]>();
  /** People already picked, so they show even if the list does not have them. */
  readonly known = input<PickerPerson[]>([]);

  protected readonly query = signal('');
  private readonly limit = signal(PAGE);

  // Every person in the admin's libraries (the API sorts named first, then by
  // size). Hidden-for-everyone people are left out; nobody can see them anyway.
  protected readonly people = injectQuery(() => ({
    queryKey: [CacheKey.FacesAll, 'picker'],
    queryFn: async () => this.trpc.faces.listPeople.query(),
    staleTime: 60_000,
  }));

  protected readonly all = computed<PickerPerson[]>(() => this.people.data() ?? []);

  private readonly byId = computed(() => {
    const map = new Map<string, PickerPerson>();
    for (const p of this.known()) map.set(p.id, p);
    for (const p of this.all()) map.set(p.id, p);
    return map;
  });

  private readonly selectedSet = computed(() => new Set(this.selected()));

  protected readonly pickedPeople = computed(() =>
    this.selected()
      .map((id) => this.byId().get(id))
      .filter((p): p is PickerPerson => !!p),
  );

  // A search matches names only; unnamed faces have nothing to match.
  protected readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return this.all();
    return this.all().filter((p) => p.name?.toLowerCase().includes(q));
  });

  protected readonly shown = computed(() => this.filtered().slice(0, this.limit()));

  protected faceUrl(faceId: string) {
    return `${this.apiUrl}/face/${faceId}`;
  }

  protected label(p: PickerPerson) {
    return p.name || 'Unnamed person';
  }

  protected isSelected(id: string) {
    return this.selectedSet().has(id);
  }

  protected setQuery(q: string) {
    this.query.set(q);
    this.limit.set(PAGE);
  }

  protected showMore() {
    this.limit.update((n) => n + PAGE);
  }

  protected toggle(id: string) {
    const next = new Set(this.selected());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.selected.set([...next]);
  }
}
