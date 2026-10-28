import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PluralPipe } from '@core/pipes/plural.pipe';
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

// Searchable grid of face avatars. Named people come first, then unnamed
// people by size; each shows its face crop and photo count so two unnamed
// people can be told apart.
// - Default (multi) mode: "Hide people from them". Picked people are listed
//   above the grid so the admin always sees the result.
// - [single]="true": pick one person (e.g. "Move faces to..."); emits (pick).
@Component({
  selector: 'app-people-picker',
  imports: [FormsModule, HlmButton, HlmInput, HlmSpinner, NgIcon, HlmIcon, PluralPipe],
  providers: [provideIcons({ lucideEyeOff, lucideSearch, lucideUser, lucideX })],
  host: { class: 'block' },
  template: `
    @if (!single() && pickedPeople().length > 0) {
      <div class="mb-3 flex flex-wrap gap-2">
        @for (p of pickedPeople(); track p.id) {
          <button
            type="button"
            class="bg-muted hover:bg-accent focus-visible:ring-ring flex min-h-11 items-center gap-1.5 rounded-full py-0.5 pr-3 pl-0.5 text-xs outline-none focus-visible:ring-2 active:scale-[0.96]"
            [attr.aria-label]="'Stop hiding ' + label(p)"
            (click)="toggle(p.id)"
          >
            <span class="bg-background block h-9 w-9 overflow-hidden rounded-full">
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
        No people found yet.
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
          type="search"
          class="h-11 w-full pl-8 sm:h-9"
          placeholder="Search people by name"
          aria-label="Search people by name"
          [ngModel]="query()"
          (ngModelChange)="setQuery($event)"
        />
      </div>

      <div class="grid max-h-80 grid-cols-3 gap-2 overflow-y-auto p-1 sm:grid-cols-4">
        @for (p of shown(); track p.id) {
          <button
            type="button"
            class="hover:bg-accent/60 focus-visible:ring-ring flex flex-col items-center gap-1 rounded-lg p-1.5 text-center outline-none focus-visible:ring-2 active:scale-[0.96]"
            [attr.aria-pressed]="single() ? null : isSelected(p.id)"
            [attr.aria-label]="ariaLabel(p)"
            (click)="single() ? choose(p) : toggle(p.id)"
          >
            <span
              class="bg-muted relative block aspect-square w-full max-w-24 overflow-hidden rounded-full outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
              [class.ring-2]="isSelected(p.id)"
              [class.ring-destructive]="!single() && isSelected(p.id)"
              [class.ring-primary]="single() && isSelected(p.id)"
            >
              @if (p.coverFaceId) {
                <img
                  class="h-full w-full object-cover"
                  [class.opacity-40]="!single() && isSelected(p.id)"
                  [src]="faceUrl(p.coverFaceId)"
                  alt=""
                  loading="lazy"
                />
              } @else {
                <span class="text-muted-foreground grid h-full w-full place-items-center">
                  <ng-icon hlm size="sm" name="lucideUser" />
                </span>
              }
              @if (!single() && isSelected(p.id)) {
                <span class="text-destructive absolute inset-0 grid place-items-center">
                  <ng-icon hlm size="sm" name="lucideEyeOff" />
                </span>
              }
            </span>
            <span class="w-full truncate text-xs font-medium" [class.text-muted-foreground]="!p.name">
              {{ label(p) }}
            </span>
            <span class="text-muted-foreground -mt-1 w-full truncate text-[11px] tabular-nums">
              {{ p.faceCount | plural: 'photo' }}
            </span>
          </button>
        } @empty {
          <p class="text-muted-foreground col-span-full py-4 text-center text-sm">
            Nobody matches "{{ query() }}".
          </p>
        }
      </div>

      @if (filtered().length > shown().length) {
        <div class="mt-2 flex justify-center">
          <button hlmBtn variant="ghost" class="h-11 sm:h-9" type="button" (click)="showMore()">
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
  readonly selected = model<string[]>([]);
  /** People already picked, so they show even if the list does not have them. */
  readonly known = input<PickerPerson[]>([]);
  /** Pick one person instead of a set. */
  readonly single = input(false);
  /** Person ids to leave out (e.g. the person the faces come from). */
  readonly exclude = input<string[]>([]);
  /** Single mode: the person the admin picked. */
  readonly pick = output<PickerPerson>();

  protected readonly query = signal('');
  private readonly limit = signal(PAGE);

  // Every person in the admin's libraries (the API sorts named first, then by
  // size). Hidden-for-everyone people are left out; nobody can see them anyway.
  protected readonly people = injectQuery(() => ({
    queryKey: [CacheKey.FacesAll, 'picker'],
    queryFn: async () => this.trpc.faces.listPeople.query(),
    staleTime: 60_000,
  }));

  protected readonly all = computed<PickerPerson[]>(() => {
    const skip = new Set(this.exclude());
    const list: PickerPerson[] = this.people.data() ?? [];
    return skip.size === 0 ? list : list.filter((p) => !skip.has(p.id));
  });

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

  // A search matches names. "unnamed" (or part of it) lists the unnamed people.
  protected readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return this.all();
    const wantUnnamed = q.length >= 3 && 'unnamed person'.startsWith(q);
    return this.all().filter((p) =>
      p.name ? p.name.toLowerCase().includes(q) : wantUnnamed,
    );
  });

  protected readonly shown = computed(() => this.filtered().slice(0, this.limit()));

  protected faceUrl(faceId: string) {
    return `${this.apiUrl}/face/${faceId}`;
  }

  protected label(p: PickerPerson) {
    return p.name || 'Unnamed person';
  }

  protected ariaLabel(p: PickerPerson) {
    const who = p.name ? p.name : `Unnamed person, ${p.faceCount} ${p.faceCount === 1 ? 'photo' : 'photos'}`;
    if (this.single()) return `Choose ${who}`;
    return (this.isSelected(p.id) ? 'Stop hiding ' : 'Hide ') + who;
  }

  protected choose(p: PickerPerson) {
    this.selected.set([p.id]);
    this.pick.emit(p);
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
