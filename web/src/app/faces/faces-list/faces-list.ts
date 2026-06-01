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
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ErrorAlert } from '@core/components/error/error';
import { Auth } from '@core/services/auth/auth';
import { CacheKey } from '@core/services/cache-key.types';
import { optimisticEdit } from '@core/services/optimistic';
import { injectTrpc, RouterOutputs } from '@core/services/trpc';
import { environment } from '@env/environment';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideArrowRight,
  lucideCheck,
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
  QueryClient,
} from '@tanstack/angular-query-experimental';

type Person = RouterOutputs['faces']['listPeoplePage']['items'][number];
type Suggestion = RouterOutputs['faces']['listMergeSuggestions'][number];

// Shape of the paginated infinite-query cache, for optimistic edits.
type PeoplePages = {
  pages: { items: Person[]; nextCursor: string | null }[];
  pageParams: unknown[];
};

@Component({
  selector: 'app-faces-list',
  providers: [
    provideIcons({
      lucideUsers,
      lucideUser,
      lucideArrowRight,
      lucideCheck,
      lucideSparkles,
      lucideX,
    }),
  ],
  imports: [ErrorAlert, NgIcon, HlmIcon, HlmInput, HlmButton, RouterLink, FormsModule],
  host: { class: 'block h-full overflow-y-auto' },
  template: `
    @if (people.isPending()) {
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        @for (i of skeletonTiles; track i) {
          <div class="bg-card flex flex-col items-center rounded-lg border p-3">
            <div class="bg-muted h-28 w-28 animate-pulse rounded-full"></div>
            <div class="bg-muted mt-3 h-4 w-20 animate-pulse rounded"></div>
            <div class="bg-muted mt-2 h-3 w-12 animate-pulse rounded"></div>
          </div>
        }
      </div>
    } @else if (people.isError() && !people.data()) {
      <app-error-alert [error]="people.error()" />
    } @else {
      <!-- Admin-only: clusters that look like the same person split in two.
           Merge folds the source into the named/larger target; "Not the same"
           dismisses the pair so it won't be suggested again. -->
      @if (isAdmin() && suggestions().length > 0) {
        <div class="bg-card mb-6 rounded-lg border p-4">
          <div class="mb-3 flex items-center gap-2">
            <ng-icon hlm size="sm" name="lucideSparkles" class="text-primary" />
            <h2 class="text-foreground text-sm font-semibold">
              People that might be the same
            </h2>
            <span class="text-muted-foreground text-xs">({{ suggestions().length }})</span>
          </div>
          <div class="flex gap-3 overflow-x-auto pb-1">
            @for (s of suggestions(); track s.source.id + '|' + s.target.id) {
              <div class="bg-background flex w-64 shrink-0 flex-col gap-3 rounded-lg border p-3">
                <div class="flex items-center justify-center gap-2">
                  <div class="flex w-20 flex-col items-center gap-1">
                    <a
                      [routerLink]="['/faces', s.source.id]"
                      class="bg-muted group relative block h-16 w-16 overflow-hidden rounded-full"
                    >
                      @if (s.source.coverFaceId) {
                        <img
                          class="h-full w-full object-cover transition-transform group-hover:scale-105"
                          [src]="apiUrl + '/face/' + s.source.coverFaceId"
                          [alt]="s.source.name || 'Unnamed person'"
                          loading="lazy"
                        />
                      } @else {
                        <span class="text-muted-foreground grid h-full w-full place-items-center">
                          <ng-icon hlm size="lg" name="lucideUser" />
                        </span>
                      }
                    </a>
                    <span class="w-full truncate text-center text-[11px] font-medium">
                      {{ s.source.name || 'Unnamed' }}
                    </span>
                    <span class="text-muted-foreground text-[11px]">
                      {{ s.source.faceCount }} {{ s.source.faceCount === 1 ? 'photo' : 'photos' }}
                    </span>
                  </div>
                  <ng-icon hlm size="sm" name="lucideArrowRight" class="text-muted-foreground" />
                  <div class="flex w-20 flex-col items-center gap-1">
                    <a
                      [routerLink]="['/faces', s.target.id]"
                      class="bg-muted group relative block h-16 w-16 overflow-hidden rounded-full"
                    >
                      @if (s.target.coverFaceId) {
                        <img
                          class="h-full w-full object-cover transition-transform group-hover:scale-105"
                          [src]="apiUrl + '/face/' + s.target.coverFaceId"
                          [alt]="s.target.name || 'Unnamed person'"
                          loading="lazy"
                        />
                      } @else {
                        <span class="text-muted-foreground grid h-full w-full place-items-center">
                          <ng-icon hlm size="lg" name="lucideUser" />
                        </span>
                      }
                    </a>
                    <span class="w-full truncate text-center text-[11px] font-medium">
                      {{ s.target.name || 'Unnamed' }}
                    </span>
                    <span class="text-muted-foreground text-[11px]">
                      {{ s.target.faceCount }} {{ s.target.faceCount === 1 ? 'photo' : 'photos' }}
                    </span>
                  </div>
                </div>

                <p class="text-muted-foreground text-center text-xs">
                  {{ (s.similarity * 100).toFixed(0) }}% match
                </p>

                <div class="flex gap-2">
                  <button
                    hlmBtn
                    size="sm"
                    class="flex-1"
                    [disabled]="busyPair() === s.source.id"
                    (click)="acceptSuggestion(s)"
                  >
                    <ng-icon hlm size="sm" name="lucideCheck" class="mr-1" />
                    Merge
                  </button>
                  <button
                    hlmBtn
                    size="sm"
                    variant="ghost"
                    [disabled]="busyPair() === s.source.id"
                    (click)="dismissSuggestion(s)"
                  >
                    <ng-icon hlm size="sm" name="lucideX" />
                  </button>
                </div>
              </div>
            }
          </div>
          @if (suggestionMerge.isError() || suggestionDismiss.isError()) {
            <app-error-alert
              [error]="(suggestionMerge.error() || suggestionDismiss.error()) || undefined"
              class="mt-3 block"
            />
          }
        </div>
      }

      @if (allPeople().length === 0) {
        <div class="text-muted-foreground flex flex-col items-center justify-center py-12">
          <ng-icon hlm size="xl" name="lucideUsers" class="mb-4" />
          <p>No people detected yet</p>
          <p class="text-sm">Faces appear here as your photos are scanned</p>
        </div>
      } @else {
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          @for (person of allPeople(); track person.id) {
            <div
              class="bg-card flex flex-col items-center rounded-lg border p-3"
              [class.opacity-60]="person.hidden"
            >
              <a [routerLink]="['/faces', person.id]" class="group block">
                <div class="bg-muted relative h-28 w-28 overflow-hidden rounded-full">
                  @if (person.hidden) {
                    <span
                      class="absolute right-1 top-1 z-10 rounded bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-medium text-white"
                    >
                      Hidden
                    </span>
                  }
                  @if (person.coverFaceId) {
                    <img
                      class="h-full w-full object-cover transition-transform group-hover:scale-105"
                      [src]="apiUrl + '/face/' + person.coverFaceId"
                      [alt]="person.name || 'Unnamed person'"
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
                  <input
                    hlmInput
                    class="h-8 w-full text-center text-sm"
                    [(ngModel)]="draftName"
                    (keydown.enter)="save(person.id)"
                    (keydown.escape)="cancel()"
                    (blur)="save(person.id)"
                    placeholder="Add a name"
                    autofocus
                  />
                } @else if (person.name) {
                  <button class="w-full truncate text-sm font-medium" (click)="edit(person.id, person.name)">
                    {{ person.name }}
                  </button>
                } @else {
                  <button
                    class="text-primary w-full truncate text-sm"
                    (click)="edit(person.id, null)"
                  >
                    Add a name
                  </button>
                }
                <p class="text-muted-foreground text-xs">{{ person.faceCount }} photos</p>
              </div>
            </div>
          }
        </div>

        <!-- Sentinel: when it scrolls near the viewport, fetch the next page. -->
        <div #sentinel class="h-px w-full"></div>
        @if (people.isFetchingNextPage()) {
          <div class="text-muted-foreground py-6 text-center text-sm">Loading more…</div>
        }
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FacesList {
  protected readonly apiUrl = environment.api.url;
  protected readonly skeletonTiles = Array.from({ length: 15 }, (_, i) => i);
  private readonly trpc = injectTrpc();
  private readonly queryClient = inject(QueryClient);
  private readonly auth = inject(Auth);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly sentinel = viewChild<ElementRef<HTMLElement>>('sentinel');

  protected readonly isAdmin = computed(() => this.auth.user()?.type === 'admin');

  protected readonly editingId = signal<string | null>(null);
  protected draftName = '';

  // Admins also see hidden people so they can unhide them; regular users don't.
  // Paginated so the page loads ~100 clusters at a time on scroll instead of
  // every cluster (and an avatar request each) up front.
  people = injectInfiniteQuery(() => ({
    queryKey: [CacheKey.FacesPage, this.isAdmin() ? 'with-hidden' : 'visible'],
    queryFn: async ({ pageParam }) =>
      this.trpc.faces.listPeoplePage.query({
        includeHidden: this.isAdmin(),
        limit: 100,
        cursor: pageParam,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  }));

  protected readonly allPeople = computed(
    () => this.people.data()?.pages.flatMap((p) => p.items) ?? [],
  );

  // Admin-only merge suggestions ("might be the same person"). The card being
  // acted on is tracked by its source id so only that card's buttons disable.
  protected readonly busyPair = signal<string | null>(null);

  private readonly suggestionsQuery = injectQuery(() => ({
    queryKey: [CacheKey.FaceSuggestions],
    queryFn: async () => this.trpc.faces.listMergeSuggestions.query({ limit: 20 }),
    enabled: this.isAdmin(),
  }));

  protected readonly suggestions = computed(
    () => (this.suggestionsQuery.data() ?? []) as Suggestion[],
  );

  // Accept a suggestion = the existing admin merge (source folded into target).
  // Drop the card immediately, then reconcile the people list and suggestions.
  protected readonly suggestionMerge = injectMutation(() => ({
    mutationFn: (vars: { targetId: string; sourceId: string }) =>
      this.trpc.faces.mergePeople.mutate(vars),
    onSuccess: (_data, vars) => {
      this.removeSuggestion(vars.sourceId, vars.targetId);
      this.queryClient.invalidateQueries({ queryKey: [CacheKey.FacesPage] });
      this.queryClient.invalidateQueries({ queryKey: [CacheKey.FacesAll] });
      this.queryClient.invalidateQueries({ queryKey: [CacheKey.FaceSuggestions] });
      this.queryClient.invalidateQueries({ queryKey: [CacheKey.FaceSingle, vars.targetId] });
    },
    onSettled: () => this.busyPair.set(null),
  }));

  // Dismiss = remember the pair is "not the same person" so it's not re-offered.
  protected readonly suggestionDismiss = injectMutation(() => ({
    mutationFn: (vars: { personIdA: string; personIdB: string }) =>
      this.trpc.faces.dismissMergeSuggestion.mutate(vars),
    onSuccess: (_data, vars) => {
      this.removeSuggestion(vars.personIdA, vars.personIdB);
      this.queryClient.invalidateQueries({ queryKey: [CacheKey.FaceSuggestions] });
    },
    onSettled: () => this.busyPair.set(null),
  }));

  acceptSuggestion(s: Suggestion): void {
    if (this.busyPair()) return;
    this.busyPair.set(s.source.id);
    this.suggestionMerge.mutate({ targetId: s.target.id, sourceId: s.source.id });
  }

  dismissSuggestion(s: Suggestion): void {
    if (this.busyPair()) return;
    this.busyPair.set(s.source.id);
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

  // Optimistic: the new name shows instantly, rolls back if the server rejects,
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
          // Keep the merge picker's flat list (faces-all) consistent too.
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
    onSettled: (_data, _err, { id }) => {
      this.queryClient.invalidateQueries({ queryKey: [CacheKey.FacesPage] });
      this.queryClient.invalidateQueries({ queryKey: [CacheKey.FacesAll] });
      this.queryClient.invalidateQueries({ queryKey: [CacheKey.FaceSingle, id] });
    },
  }));

  edit(id: string, current: string | null): void {
    this.draftName = current ?? '';
    this.editingId.set(id);
  }

  cancel(): void {
    this.editingId.set(null);
    this.draftName = '';
  }

  save(id: string): void {
    if (this.editingId() !== id) return;
    const name = this.draftName.trim();
    this.editingId.set(null);
    this.rename.mutate({ id, name: name.length > 0 ? name : null });
  }
}
