import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { environment } from '@env/environment';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucidePlus, lucideSearch, lucideUser, lucideX } from '@ng-icons/lucide';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { injectQuery } from '@tanstack/angular-query-experimental';

export type PersonPick = { personId: string } | { name: string };

const MAX_SHOWN = 40;

// Small searchable list of people for the face overlay: "This is..." and
// "Tag a face". Pick a person, or type a new name to make a new person.
@Component({
  selector: 'app-person-picker',
  imports: [NgIcon, HlmIcon, HlmSpinner],
  providers: [provideIcons({ lucidePlus, lucideSearch, lucideUser, lucideX })],
  host: {
    class:
      'bg-background text-foreground flex max-h-[min(28rem,80%)] w-[min(22rem,calc(100%-2rem))] flex-col overflow-hidden rounded-xl shadow-2xl ring-1 ring-black/10 dark:ring-white/10',
    role: 'dialog',
    '[attr.aria-label]': 'title()',
    '(pointerdown)': '$event.stopPropagation()',
    '(wheel)': '$event.stopPropagation()',
  },
  template: `
    <div class="flex items-center justify-between gap-2 border-b px-3 py-2">
      <h2 class="truncate text-sm font-semibold">{{ title() }}</h2>
      <button
        type="button"
        class="hover:bg-muted focus-visible:ring-ring grid size-11 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-2 active:scale-[0.96]"
        aria-label="Cancel"
        (click)="cancel.emit()"
      >
        <ng-icon hlm size="sm" name="lucideX" />
      </button>
    </div>

    <div class="relative px-3 pt-3">
      <ng-icon
        hlm
        size="sm"
        name="lucideSearch"
        class="text-muted-foreground pointer-events-none absolute top-1/2 left-5.5 mt-1.5 -translate-y-1/2"
      />
      <input
        #search
        type="text"
        class="border-input bg-background focus-visible:ring-ring h-11 w-full rounded-md border pr-3 pl-8 text-sm outline-none focus-visible:ring-2"
        placeholder="Search or type a new name"
        aria-label="Search people or type a new name"
        [value]="query()"
        (input)="query.set($any($event.target).value)"
        (keydown.escape)="$event.stopPropagation(); cancel.emit()"
        (keydown.enter)="onEnter()"
      />
    </div>

    <ul class="min-h-0 flex-1 overflow-y-auto p-2" role="listbox" aria-label="People">
      @if (trimmed() && !exactMatch()) {
        <li>
          <button
            type="button"
            role="option"
            class="hover:bg-muted focus-visible:bg-muted flex min-h-11 w-full items-center gap-3 rounded-lg px-2 text-left text-sm outline-none"
            (click)="picked.emit({ name: trimmed() })"
          >
            <span class="bg-primary text-primary-foreground grid size-8 shrink-0 place-items-center rounded-full">
              <ng-icon hlm size="sm" name="lucidePlus" />
            </span>
            <span class="min-w-0 truncate">New person "{{ trimmed() }}"</span>
          </button>
        </li>
      }
      @if (people.isPending()) {
        <li class="flex justify-center py-6"><hlm-spinner /></li>
      }
      @for (p of shown(); track p.id) {
        <li>
          <button
            type="button"
            role="option"
            class="hover:bg-muted focus-visible:bg-muted flex min-h-11 w-full items-center gap-3 rounded-lg px-2 text-left text-sm outline-none"
            [attr.aria-selected]="p.id === currentPersonId()"
            (click)="picked.emit({ personId: p.id })"
          >
            <span class="bg-muted block size-8 shrink-0 overflow-hidden rounded-full">
              @if (p.coverFaceId) {
                <img class="h-full w-full object-cover" [src]="apiUrl + '/face/' + p.coverFaceId" alt="" loading="lazy" />
              } @else {
                <span class="text-muted-foreground grid h-full w-full place-items-center">
                  <ng-icon hlm size="sm" name="lucideUser" />
                </span>
              }
            </span>
            <span class="min-w-0 truncate" [class.text-muted-foreground]="!p.name">
              {{ p.name || 'Unnamed person' }}
            </span>
          </button>
        </li>
      } @empty {
        @if (!people.isPending() && !trimmed()) {
          <li class="text-muted-foreground px-2 py-4 text-center text-sm">
            Nobody is named yet. Type a name to make a new person.
          </li>
        }
      }
    </ul>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonPicker {
  private readonly trpc = injectTrpc();
  protected readonly apiUrl = environment.api.url;

  readonly title = input('Who is this?');
  /** The person the face is on now, if any. It is marked in the list. */
  readonly currentPersonId = input<string | null>(null);

  readonly picked = output<PersonPick>();
  readonly cancel = output<void>();

  protected readonly query = signal('');
  protected readonly trimmed = computed(() => this.query().trim());
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('search');

  protected readonly people = injectQuery(() => ({
    queryKey: [CacheKey.FacesAll, 'viewer-person-picker'],
    queryFn: async () => this.trpc.faces.listPeople.query(),
    staleTime: 60_000,
  }));

  // Named people match the search. With no search, named people come first and
  // a few big unnamed groups follow, so an admin can still pick a face cluster.
  protected readonly shown = computed(() => {
    const all = this.people.data() ?? [];
    const q = this.trimmed().toLowerCase();
    if (q) {
      return all.filter((p) => p.name?.toLowerCase().includes(q)).slice(0, MAX_SHOWN);
    }
    const named = all.filter((p) => p.name);
    const unnamed = all.filter((p) => !p.name).slice(0, 8);
    return [...named, ...unnamed].slice(0, MAX_SHOWN);
  });

  protected readonly exactMatch = computed(() => {
    const q = this.trimmed().toLowerCase();
    return this.shown().some((p) => p.name?.toLowerCase() === q);
  });

  constructor() {
    afterNextRender(() => this.searchInput()?.nativeElement.focus({ preventScroll: true }));
  }

  protected onEnter(): void {
    const q = this.trimmed().toLowerCase();
    if (!q) return;
    const exact = this.shown().find((p) => p.name?.toLowerCase() === q);
    if (exact) this.picked.emit({ personId: exact.id });
    else this.picked.emit({ name: this.trimmed() });
  }
}
