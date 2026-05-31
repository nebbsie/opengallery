import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AssetThumbnail } from '@core/components/asset-thumbnail/asset-thumbnail';
import { BackOnEscapeDirective } from '@core/directives/back-on-escape/back-on-escape.directive';
import { ErrorAlert } from '@core/components/error/error';
import { VirtualThumbnailGrid } from '@core/components/virtual-thumbnail-grid/virtual-thumbnail-grid';
import { Auth } from '@core/services/auth/auth';
import { CacheKey } from '@core/services/cache-key.types';
import { optimisticEdit } from '@core/services/optimistic';
import { injectTrpc } from '@core/services/trpc';
import { environment } from '@env/environment';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideUser } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmInput } from '@spartan-ng/helm/input';
import { Loading } from '@core/components/loading/loading';
import {
  injectInfiniteQuery,
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';

// Shape of a person row from faces.listPeople. Declared locally so the merge
// dropdown stays typed even when the tRPC router type resolves to `any` in the
// production build.
interface PersonSummary {
  id: string;
  name: string | null;
  coverFaceId: string | null;
  faceCount: number;
  hidden: boolean;
}

// Cache keys for every browse surface a hide/merge can affect, so the UI
// reflects the change immediately instead of showing stale (now-hidden) photos.
const BROWSE_KEYS = [
  CacheKey.GalleryAll,
  CacheKey.GalleryPhotos,
  CacheKey.GalleryVideos,
  CacheKey.TimelineAll,
  CacheKey.TimelinePhotos,
  CacheKey.TimelineVideos,
  CacheKey.LocationAll,
  CacheKey.LocationSingle,
  CacheKey.CamerasAll,
  CacheKey.CameraSingle,
  CacheKey.AssetSingle,
];

@Component({
  selector: 'app-face-detail',
  providers: [provideIcons({ lucideUser })],
  imports: [
    ErrorAlert,
    Loading,
    HlmInput,
    HlmButton,
    HlmIcon,
    NgIcon,
    AssetThumbnail,
    VirtualThumbnailGrid,
    FormsModule,
  ],
  hostDirectives: [BackOnEscapeDirective],
  host: { class: 'flex flex-col h-full' },
  template: `
    @if (files.isPending() && !files.data()) {
      <app-loading />
    } @else if (files.isError() && !files.data()) {
      <app-error-alert [error]="files.error()" />
    } @else {
      <div class="mb-3 flex items-center gap-2">
        @if (editing()) {
          <input
            hlmInput
            class="h-9 text-xl font-bold"
            [(ngModel)]="draftName"
            (keydown.enter)="save()"
            (keydown.escape)="editing.set(false)"
            placeholder="Add a name"
            autofocus
          />
          <button hlmBtn size="sm" (click)="save()">Save</button>
        } @else {
          <h1 class="text-foreground text-2xl font-bold">
            {{ person.data()?.name || 'Unnamed person' }}
          </h1>
          @if (person.data()?.hidden) {
            <span
              class="rounded bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600"
            >
              Hidden
            </span>
          }
          <button hlmBtn variant="ghost" size="sm" (click)="startEdit()">
            {{ person.data()?.name ? 'Rename' : 'Add a name' }}
          </button>
        }
      </div>

      <!-- Admin-only curation: merge this person into another, and hide/unhide
           (hiding also removes their photos from the gallery, timeline & map). -->
      @if (isAdmin()) {
        <div class="bg-muted/40 mb-4 flex flex-wrap items-center gap-2 rounded-lg border p-2">
          @if (!mergeOpen()) {
            <button hlmBtn size="sm" variant="outline" (click)="openMerge()">
              Merge…
            </button>
          } @else if (!confirmingMerge()) {
            <!-- Pick a person to merge into. Clicking a row goes straight to the
                 confirm step — no separate "select" button. -->
            <div class="flex w-full max-w-sm flex-col gap-2">
              <div class="flex items-center gap-2">
                <input
                  hlmInput
                  class="h-9 flex-1 text-sm"
                  [(ngModel)]="mergeSearch"
                  placeholder="Merge into… type to search people"
                  autofocus
                />
                <button hlmBtn size="sm" variant="ghost" (click)="closeMerge()">Cancel</button>
              </div>
              <div class="bg-background max-h-56 divide-y overflow-y-auto rounded-md border">
                @for (p of mergeTargets(); track p.id) {
                  <button
                    type="button"
                    class="hover:bg-muted flex w-full items-center gap-2 px-2 py-2 text-left text-sm"
                    (click)="pickMergeTarget(p.id)"
                  >
                    <span class="bg-muted relative h-7 w-7 shrink-0 overflow-hidden rounded-full">
                      @if (p.coverFaceId) {
                        <img
                          class="h-full w-full object-cover"
                          [src]="apiUrl + '/face/' + p.coverFaceId"
                          [alt]="p.name || ''"
                          loading="lazy"
                        />
                      } @else {
                        <span class="text-muted-foreground grid h-full w-full place-items-center">
                          <ng-icon hlm size="sm" name="lucideUser" />
                        </span>
                      }
                    </span>
                    <span class="truncate">{{ p.name }}</span>
                    <span class="text-muted-foreground ml-auto shrink-0">({{ p.faceCount }})</span>
                  </button>
                } @empty {
                  <p class="text-muted-foreground px-2 py-2 text-sm">No matching people.</p>
                }
              </div>
            </div>
          } @else if (selectedTarget(); as t) {
            <div class="flex w-full max-w-sm flex-wrap items-center gap-2">
              <span class="bg-muted relative h-8 w-8 shrink-0 overflow-hidden rounded-full">
                @if (t.coverFaceId) {
                  <img
                    class="h-full w-full object-cover"
                    [src]="apiUrl + '/face/' + t.coverFaceId"
                    [alt]="t.name || ''"
                    loading="lazy"
                  />
                } @else {
                  <span class="text-muted-foreground grid h-full w-full place-items-center">
                    <ng-icon hlm size="sm" name="lucideUser" />
                  </span>
                }
              </span>
              <span class="text-sm">
                Merge into <strong>{{ t.name }}</strong>?
                <span class="text-muted-foreground">Can't be undone.</span>
              </span>
              <div class="ml-auto flex gap-2">
                <button hlmBtn size="sm" (click)="merge()" [disabled]="mergeMutation.isPending()">
                  {{ mergeMutation.isPending() ? 'Merging…' : 'Merge' }}
                </button>
                <button
                  hlmBtn
                  size="sm"
                  variant="ghost"
                  [disabled]="mergeMutation.isPending()"
                  (click)="confirmingMerge.set(false)"
                >
                  Back
                </button>
              </div>
            </div>
          }

          <div class="ml-auto">
            <button
              hlmBtn
              size="sm"
              [variant]="person.data()?.hidden ? 'outline' : 'destructive'"
              (click)="toggleHidden()"
              [disabled]="hideMutation.isPending()"
            >
              {{ person.data()?.hidden ? 'Unhide person' : 'Hide person' }}
            </button>
          </div>
        </div>

        @if (mergeMutation.isError()) {
          <app-error-alert [error]="mergeMutation.error() || undefined" />
        }
        @if (hideMutation.isError()) {
          <app-error-alert [error]="hideMutation.error() || undefined" />
        }
      }

      <app-virtual-thumbnail-grid
        class="min-h-0 flex-1"
        [items]="allItems()"
        [hasMore]="files.hasNextPage()"
        [isLoadingMore]="files.isFetchingNextPage()"
        [scrollKey]="scrollKey()"
        (loadMore)="loadMore()"
      >
        <ng-template let-asset>
          <app-asset-thumbnail [from]="fromPath()" [personId]="id()" [asset]="asset" />
        </ng-template>
      </app-virtual-thumbnail-grid>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FaceDetail {
  id = input.required<string>();

  private readonly trpc = injectTrpc();
  private readonly queryClient = inject(QueryClient);
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);

  protected readonly isAdmin = computed(() => this.auth.user()?.type === 'admin');

  protected readonly editing = signal(false);
  protected draftName = '';

  // Merge controls stay collapsed behind a "Merge…" button until the admin opens
  // them, so the toolbar isn't cluttered for the common (view/rename) case.
  protected readonly mergeOpen = signal(false);
  protected readonly mergeTargetId = signal<string>('');
  protected readonly confirmingMerge = signal(false);
  protected readonly mergeSearch = signal('');

  protected readonly apiUrl = environment.api.url;

  fromPath = computed(() => `/faces/${this.id()}`);
  scrollKey = computed(() => `face-${this.id()}`);

  person = injectQuery(() => ({
    queryKey: [CacheKey.FaceSingle, this.id()],
    queryFn: async () => this.trpc.faces.getPerson.query(this.id()),
  }));

  // Other people this cluster can be merged into. Admin-only, so include hidden
  // clusters too. Excludes the current person.
  private readonly peopleList = injectQuery(() => ({
    queryKey: [CacheKey.FacesAll, 'merge-targets'],
    queryFn: async () => this.trpc.faces.listPeople.query({ includeHidden: true }),
    enabled: this.isAdmin(),
  }));

  protected readonly mergeTargets = computed(() => {
    // Param is typed explicitly: in the production build the tRPC router type
    // can resolve to `any`, so relying on inference here trips noImplicitAny.
    const people = (this.peopleList.data() ?? []) as PersonSummary[];
    const query = this.mergeSearch().trim().toLowerCase();
    return people.filter(
      (p: PersonSummary) =>
        // Exclude the current cluster, and only offer named people as merge
        // targets — merging into an "Unnamed person" is never the intent.
        p.id !== this.id() &&
        !!p.name &&
        (query === '' || p.name.toLowerCase().includes(query)),
    );
  });

  // The chosen merge target, shown (with avatar) in the confirm step once the
  // search list has collapsed.
  protected readonly selectedTarget = computed(() => {
    const id = this.mergeTargetId();
    const people = (this.peopleList.data() ?? []) as PersonSummary[];
    return people.find((p: PersonSummary) => p.id === id) ?? null;
  });

  files = injectInfiniteQuery(() => ({
    queryKey: [CacheKey.FaceFiles, this.id()],
    queryFn: async ({ pageParam }) =>
      this.trpc.faces.getPersonFiles.query({
        personId: this.id(),
        limit: 60,
        cursor: pageParam,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  }));

  // Optimistic rename: the heading + people list update instantly, roll back on
  // failure, and reconcile via the background refetch in onSettled.
  private rename = injectMutation(() => ({
    mutationFn: (name: string | null) =>
      this.trpc.faces.renamePerson.mutate({ id: this.id(), name }),
    onMutate: async (name) => {
      const id = this.id();
      await this.queryClient.cancelQueries({ queryKey: [CacheKey.FaceSingle, id] });
      await this.queryClient.cancelQueries({ queryKey: [CacheKey.FacesAll] });
      return optimisticEdit(this.queryClient, [
        {
          queryKey: [CacheKey.FaceSingle, id],
          update: (old) => (old ? { ...(old as PersonSummary), name } : old),
        },
        {
          queryKey: [CacheKey.FacesAll],
          update: (old) =>
            (old as PersonSummary[] | undefined)?.map((p) =>
              p.id === id ? { ...p, name } : p,
            ),
        },
      ]);
    },
    onError: (_err, _name, ctx) => ctx?.rollback(),
    onSettled: () => {
      this.queryClient.invalidateQueries({ queryKey: [CacheKey.FaceSingle, this.id()] });
      this.queryClient.invalidateQueries({ queryKey: [CacheKey.FacesAll] });
    },
  }));

  // Optimistic hide/unhide: the badge flips instantly. Browse surfaces (gallery,
  // timeline, map) can't be updated optimistically — the server applies the
  // person filter — so they're invalidated once the toggle actually succeeds.
  hideMutation = injectMutation(() => ({
    mutationFn: (hidden: boolean) =>
      this.trpc.faces.hidePerson.mutate({ id: this.id(), hidden }),
    onMutate: async (hidden) => {
      const id = this.id();
      await this.queryClient.cancelQueries({ queryKey: [CacheKey.FaceSingle, id] });
      await this.queryClient.cancelQueries({ queryKey: [CacheKey.FacesAll] });
      return optimisticEdit(this.queryClient, [
        {
          queryKey: [CacheKey.FaceSingle, id],
          update: (old) => (old ? { ...(old as PersonSummary), hidden } : old),
        },
        {
          queryKey: [CacheKey.FacesAll],
          update: (old) =>
            (old as PersonSummary[] | undefined)?.map((p) =>
              p.id === id ? { ...p, hidden } : p,
            ),
        },
      ]);
    },
    onError: (_err, _hidden, ctx) => ctx?.rollback(),
    onSuccess: () => this.invalidateBrowseSurfaces(),
    onSettled: () => {
      this.queryClient.invalidateQueries({ queryKey: [CacheKey.FaceSingle, this.id()] });
      this.queryClient.invalidateQueries({ queryKey: [CacheKey.FacesAll] });
      this.queryClient.invalidateQueries({ queryKey: [CacheKey.FaceFiles, this.id()] });
    },
  }));

  // Optimistic merge: drop this cluster from the people list immediately, then
  // navigate to the target on success. Roll back (restore the cluster) on error.
  mergeMutation = injectMutation(() => ({
    mutationFn: (targetId: string) =>
      this.trpc.faces.mergePeople.mutate({ targetId, sourceId: this.id() }),
    onMutate: async () => {
      const sourceId = this.id();
      await this.queryClient.cancelQueries({ queryKey: [CacheKey.FacesAll] });
      return optimisticEdit(this.queryClient, [
        {
          queryKey: [CacheKey.FacesAll],
          update: (old) =>
            (old as PersonSummary[] | undefined)?.filter((p) => p.id !== sourceId),
        },
      ]);
    },
    onError: (_err, _targetId, ctx) => ctx?.rollback(),
    onSuccess: (_data, targetId) => {
      this.queryClient.invalidateQueries({ queryKey: [CacheKey.FacesAll] });
      this.queryClient.invalidateQueries({ queryKey: [CacheKey.FaceSuggestions] });
      this.queryClient.invalidateQueries({ queryKey: [CacheKey.FaceSingle, targetId] });
      this.queryClient.invalidateQueries({ queryKey: [CacheKey.FaceFiles, targetId] });
      this.closeMerge();
      // This cluster no longer exists — go to the cluster it merged into.
      void this.router.navigate(['/faces', targetId]);
    },
  }));

  allItems = computed(() => {
    const data = this.files.data();
    if (!data) return [];
    return data.pages.flatMap((page) => page.items);
  });

  startEdit(): void {
    this.draftName = this.person.data()?.name ?? '';
    this.editing.set(true);
  }

  save(): void {
    const name = this.draftName.trim();
    this.editing.set(false);
    this.rename.mutate(name.length > 0 ? name : null);
  }

  toggleHidden(): void {
    this.hideMutation.mutate(!this.person.data()?.hidden);
  }

  openMerge(): void {
    this.mergeOpen.set(true);
  }

  // Picking a person from the list jumps straight to the confirm step.
  pickMergeTarget(id: string): void {
    this.mergeTargetId.set(id);
    this.confirmingMerge.set(true);
  }

  closeMerge(): void {
    this.mergeOpen.set(false);
    this.confirmingMerge.set(false);
    this.mergeTargetId.set('');
    this.mergeSearch.set('');
  }

  merge(): void {
    const targetId = this.mergeTargetId();
    if (!targetId) return;
    this.mergeMutation.mutate(targetId);
  }

  loadMore(): void {
    if (this.files.hasNextPage() && !this.files.isFetchingNextPage()) {
      this.files.fetchNextPage();
    }
  }

  private invalidateBrowseSurfaces(): void {
    for (const key of BROWSE_KEYS) {
      this.queryClient.invalidateQueries({ queryKey: [key] });
    }
  }
}
