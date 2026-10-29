import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { ErrorAlert } from '@core/components/error/error';
import { PickerPerson } from '@core/components/people-picker/people-picker';
import { PluralPipe } from '@core/pipes/plural.pipe';
import { Auth } from '@core/services/auth/auth';
import { CacheKey } from '@core/services/cache-key.types';
import { optimisticEdit } from '@core/services/optimistic';
import { injectTrpc, RouterOutputs } from '@core/services/trpc';
import { environment } from '@env/environment';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideArrowRight,
  lucideCheck,
  lucideScanFace,
  lucideSearch,
  lucideSparkles,
  lucideUser,
  lucideUsers,
  lucideX,
} from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmInput } from '@spartan-ng/helm/input';
import {
  injectInfiniteQuery,
  injectMutation,
  injectQuery,
  keepPreviousData,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { FaceActions, faceAlt } from '../face-actions';
import { FaceReview, REVIEW_LIMIT, reviewCountText, reviewQueryKey } from '../face-review/face-review';
import { NameInput } from '../name-input/name-input';

type Person = RouterOutputs['faces']['listPeoplePage']['items'][number];
type Suggestion = RouterOutputs['faces']['listMergeSuggestions'][number];
type Filter = 'all' | 'named' | 'unnamed';

// Shape of the paginated infinite-query cache, for optimistic edits.
type PeoplePages = {
  pages: { items: Person[]; nextCursor: string | null }[];
  pageParams: unknown[];
};

const SKELETON = Array.from({ length: 15 }, (_, i) => i);
const SEARCH_DEBOUNCE_MS = 250;

@Component({
  selector: 'app-faces-list',
  providers: [
    provideIcons({
      lucideUsers,
      lucideUser,
      lucideArrowRight,
      lucideCheck,
      lucideScanFace,
      lucideSearch,
      lucideSparkles,
      lucideX,
    }),
  ],
  imports: [
    ErrorAlert,
    NgIcon,
    HlmIcon,
    HlmInput,
    HlmButton,
    RouterLink,
    PluralPipe,
    NameInput,
    FaceReview,
  ],
  host: { class: 'block h-full overflow-y-auto' },
  template: `
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <h1 class="text-foreground text-2xl font-bold">People</h1>
      @if (isAdmin() && reviewCount() > 0) {
        <button
          hlmBtn
          variant="outline"
          class="ml-auto h-11 active:scale-[0.96] sm:h-9"
          (click)="reviewOpen.set(true)"
        >
          <ng-icon hlm size="sm" name="lucideScanFace" />
          Review faces
          <span class="bg-primary text-primary-foreground rounded-full px-1.5 text-xs tabular-nums">
            {{ reviewCountLabel() }}
          </span>
        </button>
      }
    </div>

    <div class="mb-4 flex flex-wrap items-center gap-2">
      <div class="relative w-full sm:w-72">
        <ng-icon
          hlm
          size="sm"
          name="lucideSearch"
          class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2"
        />
        <input
          hlmInput
          type="search"
          class="h-11 w-full pl-8 sm:h-9"
          placeholder="Search people"
          aria-label="Search people by name"
          [value]="searchInput()"
          (input)="searchInput.set($any($event.target).value)"
        />
      </div>
      <div role="radiogroup" aria-label="Show" class="flex gap-1">
        @for (f of filters; track f.id) {
          <button
            type="button"
            role="radio"
            [attr.aria-checked]="filter() === f.id"
            class="focus-visible:ring-ring min-h-11 rounded-full border px-4 text-sm font-medium outline-none transition-[background-color,color,border-color] duration-150 focus-visible:ring-2 active:scale-[0.96] sm:min-h-8"
            [class]="
              filter() === f.id
                ? 'bg-primary text-primary-foreground border-primary'
                : 'text-foreground hover:bg-accent'
            "
            (click)="filter.set(f.id)"
          >
            {{ f.label }}
          </button>
        }
      </div>
    </div>

    <!-- Admin-only: clusters that look like the same person split in two.
         Merge folds the source into the named or larger target in one click,
         with Undo in the toast. "Not the same" dismisses the pair for good. -->
    @if (isAdmin() && suggestions().length > 0 && !search()) {
      <section class="bg-glass-tint mb-6 rounded-2xl border border-glass-border p-4" aria-labelledby="suggestions-title">
        <div class="mb-3 flex items-center gap-2">
          <ng-icon hlm size="sm" name="lucideSparkles" class="text-primary" />
          <h2 id="suggestions-title" class="text-foreground text-sm font-semibold">
            Same person?
          </h2>
          <span class="text-muted-foreground text-xs tabular-nums">({{ suggestions().length }})</span>
        </div>
        <div class="flex gap-3 overflow-x-auto pb-1">
          @for (s of suggestions(); track s.source.id + '|' + s.target.id) {
            <div class="bg-background/70 flex w-64 shrink-0 flex-col gap-3 rounded-xl border border-glass-border p-3">
              <div class="flex items-center justify-center gap-2">
                @for (p of [s.source, s.target]; track p.id; let first = $first) {
                  @if (!first) {
                    <ng-icon hlm size="sm" name="lucideArrowRight" class="text-muted-foreground" />
                  }
                  <div class="flex w-20 flex-col items-center gap-1">
                    <a
                      [routerLink]="['/faces', p.id]"
                      class="bg-muted group focus-visible:ring-ring relative block h-16 w-16 overflow-hidden rounded-full outline-none focus-visible:ring-2"
                    >
                      @if (p.coverFaceId) {
                        <img
                          class="h-full w-full object-cover transition-transform group-hover:scale-105"
                          [src]="apiUrl + '/face/' + p.coverFaceId"
                          [alt]="faceAlt(p.name)"
                          loading="lazy"
                        />
                      } @else {
                        <span class="text-muted-foreground grid h-full w-full place-items-center">
                          <ng-icon hlm size="lg" name="lucideUser" />
                        </span>
                      }
                    </a>
                    <span class="w-full truncate text-center text-[11px] font-medium">
                      {{ p.name || 'Unnamed' }}
                    </span>
                    <span class="text-muted-foreground text-[11px] tabular-nums">
                      {{ p.faceCount | plural: 'photo' }}
                    </span>
                  </div>
                }
              </div>

              <p class="text-muted-foreground text-center text-xs tabular-nums">
                {{ (s.similarity * 100).toFixed(0) }}% match
              </p>

              <div class="flex gap-2">
                <button
                  hlmBtn
                  class="h-11 flex-1 active:scale-[0.96] sm:h-8"
                  [disabled]="busyPair() === pairKey(s)"
                  (click)="acceptSuggestion(s)"
                >
                  <ng-icon hlm size="sm" name="lucideCheck" />
                  Merge
                </button>
                <button
                  hlmBtn
                  variant="ghost"
                  class="h-11 w-11 p-0 active:scale-[0.96] sm:h-8 sm:w-8"
                  [attr.aria-label]="'Not the same person: keep ' + (s.source.name || 'these people') + ' apart'"
                  title="Not the same person"
                  [disabled]="busyPair() === pairKey(s)"
                  (click)="dismissSuggestion(s)"
                >
                  <ng-icon hlm size="sm" name="lucideX" />
                </button>
              </div>
            </div>
          }
        </div>
        @if (suggestionDismiss.isError()) {
          <app-error-alert [error]="suggestionDismiss.error() || undefined" class="mt-3 block" />
        }
      </section>
    }

    @if (people.isPending()) {
      <!-- First load: the same grid with grey avatars, so nothing moves when data lands. -->
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5" aria-busy="true" aria-label="Loading people">
        @for (i of skeleton; track i) {
          <div class="flex flex-col items-center rounded-lg border p-3">
            <div class="bg-muted h-28 w-28 animate-pulse rounded-full"></div>
            <div class="bg-muted mt-3 h-4 w-20 animate-pulse rounded"></div>
            <div class="bg-muted mt-1.5 h-3 w-12 animate-pulse rounded"></div>
          </div>
        }
      </div>
    } @else if (people.isError() && !people.data()) {
      <app-error-alert [error]="people.error()" />
    } @else {
      @if (allPeople().length === 0) {
        <div class="text-muted-foreground flex flex-col items-center justify-center py-12 text-center">
          <ng-icon hlm size="xl" name="lucideUsers" class="mb-4" />
          @if (search()) {
            <p>Nobody matches "{{ search() }}"</p>
          } @else if (filter() !== 'all') {
            <p>No {{ filter() }} people</p>
          } @else {
            <p>No people found yet</p>
          }
        </div>
      } @else {
        <ul
          class="grid grid-cols-2 gap-4 transition-opacity duration-150 sm:grid-cols-3 lg:grid-cols-5"
          [class.opacity-60]="people.isPlaceholderData()"
          aria-label="People"
        >
          @for (person of allPeople(); track person.id) {
            <li
              class="bg-glass-tint flex flex-col items-center rounded-2xl border border-glass-border p-3"
              [class.opacity-60]="isAdmin() && person.hidden"
            >
              <a
                [routerLink]="['/faces', person.id]"
                class="group focus-visible:ring-ring block rounded-full outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                [attr.aria-label]="(person.name || 'Unnamed person') + ', ' + (person.faceCount | plural: 'photo')"
              >
                <div
                  class="bg-muted relative h-28 w-28 overflow-hidden rounded-full"
                >
                  @if (isAdmin() && person.hidden) {
                    <span
                      class="absolute top-1 right-1 z-10 rounded bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-medium text-black"
                    >
                      Hidden
                    </span>
                  }
                  @if (person.coverFaceId) {
                    <img
                      class="h-full w-full object-cover transition-transform group-hover:scale-105"
                      [src]="apiUrl + '/face/' + person.coverFaceId"
                      [alt]="faceAlt(person.name)"
                      loading="lazy"
                    />
                  } @else {
                    <div class="text-muted-foreground grid h-full w-full place-items-center">
                      <ng-icon hlm size="lg" name="lucideUser" />
                    </div>
                  }
                </div>
              </a>

              <div class="mt-2 w-full text-center">
                @if (editingId() === person.id) {
                  <app-name-input
                    [personId]="person.id"
                    [initial]="person.name"
                    [label]="'Name for ' + (person.name || 'unnamed person')"
                    (saved)="saveName(person.id, $event)"
                    (merge)="mergeInto(person, $event)"
                    (cancelled)="editingId.set(null)"
                  />
                } @else if (!isAdmin()) {
                  <!-- Only the admin names people. -->
                  <p class="flex min-h-9 items-center justify-center truncate text-sm font-medium">
                    {{ person.name || 'Unnamed person' }}
                  </p>
                } @else if (person.name) {
                  <button
                    class="hover:bg-accent focus-visible:ring-ring min-h-9 w-full truncate rounded-md px-1 text-sm font-medium outline-none focus-visible:ring-2"
                    [attr.aria-label]="'Rename ' + person.name"
                    (click)="editingId.set(person.id)"
                  >
                    {{ person.name }}
                  </button>
                } @else {
                  <button
                    class="text-primary hover:bg-accent focus-visible:ring-ring min-h-9 w-full truncate rounded-md px-1 text-sm font-medium outline-none focus-visible:ring-2"
                    (click)="editingId.set(person.id)"
                  >
                    Add a name
                  </button>
                }
                <p class="text-muted-foreground text-xs tabular-nums">
                  {{ person.faceCount | plural: 'photo' }}
                </p>
              </div>
            </li>
          }
        </ul>

        <!-- Sentinel: when it scrolls near the viewport, fetch the next page. -->
        <div #sentinel class="h-px w-full"></div>
        @if (people.isFetchingNextPage()) {
          <div class="text-muted-foreground py-6 text-center text-sm">Loading more people</div>
        }
      }

      <!-- Google-style: unnamed people in fewer than 3 photos stay out of the
           way unless asked for. Shown once the main list has fully loaded. -->
      @if (filter() !== 'named' && !people.hasNextPage()) {
        <div class="flex justify-center py-6">
          <button
            hlmBtn
            variant="ghost"
            class="h-11 active:scale-[0.96]"
            [attr.aria-pressed]="includeSmall()"
            (click)="includeSmall.set(!includeSmall())"
          >
            {{ includeSmall() ? 'Hide small groups' : 'Show small groups' }}
          </button>
        </div>
        @if (!includeSmall()) {
          <p class="text-muted-foreground -mt-4 pb-6 text-center text-xs text-pretty">
            Small groups are unnamed people in fewer than 3 photos.
          </p>
        }
      }
    }

    @if (reviewOpen()) {
      <app-face-review [personId]="null" (closed)="reviewOpen.set(false)" />
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FacesList {
  protected readonly apiUrl = environment.api.url;
  private readonly trpc = injectTrpc();
  private readonly queryClient = inject(QueryClient);
  private readonly auth = inject(Auth);
  private readonly actions = inject(FaceActions);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly sentinel = viewChild<ElementRef<HTMLElement>>('sentinel');
  protected readonly skeleton = SKELETON;
  protected readonly faceAlt = faceAlt;

  // False while the admin previews as another user, so the page looks exactly
  // as that user sees it.
  protected readonly isAdmin = this.auth.isAdmin;

  protected readonly editingId = signal<string | null>(null);
  protected readonly reviewOpen = signal(false);

  protected readonly filters: { id: Filter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'named', label: 'Named' },
    { id: 'unnamed', label: 'Unnamed' },
  ];
  protected readonly filter = signal<Filter>('all');
  protected readonly includeSmall = signal(false);
  // What the user types; the query uses the debounced copy.
  protected readonly searchInput = signal('');
  protected readonly search = signal('');

  // Admins also see hidden people so they can unhide them; regular users do not.
  // Paginated: about 100 people at a time on scroll. The previous result stays
  // on screen (dimmed) while a new search or filter loads, so nothing jumps.
  people = injectInfiniteQuery(() => ({
    queryKey: [
      CacheKey.FacesPage,
      this.isAdmin() ? 'with-hidden' : 'visible',
      this.search(),
      this.filter(),
      this.includeSmall(),
    ],
    queryFn: async ({ pageParam }) =>
      this.trpc.faces.listPeoplePage.query({
        includeHidden: this.isAdmin(),
        limit: 100,
        cursor: pageParam,
        search: this.search() || undefined,
        filter: this.filter(),
        includeSmall: this.includeSmall(),
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    placeholderData: keepPreviousData,
  }));

  protected readonly allPeople = computed<Person[]>(
    () => this.people.data()?.pages.flatMap((p) => p.items) ?? [],
  );

  // Admin-only "Is this X?" queue across every named person.
  private readonly review = injectQuery(() => ({
    queryKey: reviewQueryKey(null),
    queryFn: async () => this.trpc.faces.listConfirmCandidates.query({ limit: REVIEW_LIMIT }),
    enabled: this.isAdmin(),
  }));
  protected readonly reviewCount = computed(() => this.review.data()?.length ?? 0);
  protected readonly reviewCountLabel = computed(() => reviewCountText(this.reviewCount()));

  // Admin-only merge suggestions ("might be the same person"). The card being
  // acted on is tracked by its pair key so only that card's buttons disable.
  protected readonly busyPair = signal<string | null>(null);

  private readonly suggestionsQuery = injectQuery(() => ({
    queryKey: [CacheKey.FaceSuggestions],
    queryFn: async () => this.trpc.faces.listMergeSuggestions.query({ limit: 20 }),
    enabled: this.isAdmin(),
  }));

  protected readonly suggestions = computed(
    () => (this.suggestionsQuery.data() ?? []) as Suggestion[],
  );

  // Dismiss = remember the pair is "not the same person" so it is not offered again.
  protected readonly suggestionDismiss = injectMutation(() => ({
    mutationFn: (vars: { personIdA: string; personIdB: string }) =>
      this.trpc.faces.dismissMergeSuggestion.mutate(vars),
    onSuccess: (_data, vars) => {
      this.removeSuggestion(vars.personIdA, vars.personIdB);
      this.queryClient.invalidateQueries({ queryKey: [CacheKey.FaceSuggestions] });
    },
    onSettled: () => this.busyPair.set(null),
  }));

  protected pairKey(s: Suggestion): string {
    return `${s.source.id}|${s.target.id}`;
  }

  // One click merges; the toast offers Undo (valid for 10 minutes).
  async acceptSuggestion(s: Suggestion): Promise<void> {
    if (this.busyPair()) return;
    this.busyPair.set(this.pairKey(s));
    try {
      const who = s.target.name || s.source.name;
      await this.actions.merge(
        s.target.id,
        s.source.id,
        who ? `Merged into ${who}` : 'Merged into one person',
        { done: () => this.removeSuggestion(s.source.id, s.target.id) },
      );
    } finally {
      this.busyPair.set(null);
    }
  }

  dismissSuggestion(s: Suggestion): void {
    if (this.busyPair()) return;
    this.busyPair.set(this.pairKey(s));
    this.suggestionDismiss.mutate({ personIdA: s.source.id, personIdB: s.target.id });
  }

  // Drop one card from the cached suggestions array for instant feedback.
  private removeSuggestion(sourceId: string, targetId: string): void {
    this.queryClient.setQueryData(
      [CacheKey.FaceSuggestions],
      (old: unknown) =>
        Array.isArray(old)
          ? (old as Suggestion[]).filter(
              (s) => !(s.source.id === sourceId && s.target.id === targetId),
            )
          : old,
    );
  }

  constructor() {
    // Debounce the search box so each key press does not start a request.
    effect((onCleanup) => {
      const value = this.searchInput().trim();
      const t = setTimeout(() => this.search.set(value), SEARCH_DEBOUNCE_MS);
      onCleanup(() => clearTimeout(t));
    });

    // Observe the bottom sentinel within the scroll container; prefetch the next
    // page a bit before it comes into view. Re-runs if the sentinel re-renders.
    effect((onCleanup) => {
      const el = this.sentinel()?.nativeElement;
      if (!el) return;
      const obs = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) this.loadMore();
        },
        { root: this.host.nativeElement, rootMargin: '600px' },
      );
      obs.observe(el);
      onCleanup(() => obs.disconnect());
    });
  }

  loadMore(): void {
    if (this.people.hasNextPage() && !this.people.isFetchingNextPage()) {
      this.people.fetchNextPage();
    }
  }

  // Optimistic: the new name shows at once, rolls back if the server rejects,
  // and is reconciled by the background refetch in onSettled.
  private rename = injectMutation(() => ({
    mutationFn: (vars: { id: string; name: string | null }) =>
      this.trpc.faces.renamePerson.mutate(vars),
    onMutate: async ({ id, name }) => {
      await this.queryClient.cancelQueries({ queryKey: [CacheKey.FacesPage] });
      await this.queryClient.cancelQueries({ queryKey: [CacheKey.FaceSingle, id] });
      return optimisticEdit(this.queryClient, [
        {
          queryKey: [CacheKey.FacesPage],
          update: (old) => {
            const pages = (old as PeoplePages | undefined)?.pages;
            if (!pages) return old;
            return {
              ...(old as PeoplePages),
              pages: pages.map((pg) => ({
                ...pg,
                items: pg.items.map((p) => (p.id === id ? { ...p, name } : p)),
              })),
            };
          },
        },
        {
          // Keep the flat lists (merge picker, autocomplete) consistent too.
          queryKey: [CacheKey.FacesAll],
          update: (old) =>
            Array.isArray(old)
              ? old.map((p: Person) => (p.id === id ? { ...p, name } : p))
              : old,
        },
        {
          queryKey: [CacheKey.FaceSingle, id],
          update: (old) => (old ? { ...(old as Person), name } : old),
        },
      ]);
    },
    onError: (_err, _vars, ctx) => ctx?.rollback(),
    // Every face cache shows names, the viewer's face boxes and chips too.
    onSettled: () => this.actions.invalidateFaces(),
  }));

  saveName(id: string, name: string | null): void {
    this.editingId.set(null);
    this.rename.mutate({ id, name });
  }

  // "Add a name" picked an existing name: fold this person into that one.
  async mergeInto(source: Person, target: PickerPerson): Promise<void> {
    this.editingId.set(null);
    await this.actions.merge(target.id, source.id, `Merged into ${target.name}`);
  }
}
