import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AssetThumbnail } from '@core/components/asset-thumbnail/asset-thumbnail';
import { BackOnEscapeDirective } from '@core/directives/back-on-escape/back-on-escape.directive';
import { ErrorAlert } from '@core/components/error/error';
import { PickerPerson } from '@core/components/people-picker/people-picker';
import { SelectionBar } from '@core/components/selection-bar/selection-bar';
import { VirtualThumbnailGrid } from '@core/components/virtual-thumbnail-grid/virtual-thumbnail-grid';
import { PluralPipe } from '@core/pipes/plural.pipe';
import { Auth } from '@core/services/auth/auth';
import { CacheKey } from '@core/services/cache-key.types';
import { GridSelection } from '@core/services/selection/grid-selection';
import { optimisticEdit } from '@core/services/optimistic';
import { injectTrpc } from '@core/services/trpc';
import { environment } from '@env/environment';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideEllipsis,
  lucideEye,
  lucideEyeOff,
  lucideMerge,
  lucidePencil,
  lucideScanFace,
  lucideUser,
} from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmInput } from '@spartan-ng/helm/input';
import { Loading } from '@core/components/loading/loading';
import {
  injectInfiniteQuery,
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import {
  HideFromDialog,
  HideFromTarget,
} from '../../shared-viewer/hide-from-dialog/hide-from-dialog';
import { joinNames, Viewer, viewerRulesKeys } from '../../shared-viewer/viewer-rules';
import { FaceActions, faceAlt } from '../face-actions';
import {
  FaceReview,
  REVIEW_LIMIT,
  reviewCountText,
  reviewQueryKey,
} from '../face-review/face-review';
import { NameInput } from '../name-input/name-input';
import { PersonFaces } from './person-faces';

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

type Tab = 'photos' | 'faces';

@Component({
  selector: 'app-face-detail',
  providers: [
    GridSelection,
    provideIcons({
      lucideEllipsis,
      lucideEye,
      lucideEyeOff,
      lucideMerge,
      lucidePencil,
      lucideScanFace,
      lucideUser,
    }),
  ],
  imports: [
    ErrorAlert,
    Loading,
    HlmInput,
    HlmButton,
    HlmIcon,
    NgIcon,
    AssetThumbnail,
    VirtualThumbnailGrid,
    SelectionBar,
    FormsModule,
    PluralPipe,
    NameInput,
    PersonFaces,
    FaceReview,
  ],
  hostDirectives: [BackOnEscapeDirective],
  host: { class: 'flex flex-col h-full' },
  template: `
    @if (files.isPending() && !files.data()) {
      <app-loading />
    } @else if (files.isError() && !files.data()) {
      <app-error-alert [error]="files.error()" />
    } @else {
      <div class="mb-3 flex items-center gap-3">
        @if (person.data()?.coverFaceId; as cover) {
          <img
            class="bg-muted size-12 shrink-0 rounded-full object-cover"
            [src]="apiUrl + '/face/' + cover"
            [alt]="faceAlt(person.data()?.name)"
          />
        }
        @if (editing()) {
          <app-name-input
            class="w-full max-w-sm"
            [personId]="id()"
            [initial]="person.data()?.name ?? null"
            [large]="true"
            (saved)="saveName($event)"
            (merge)="mergeInto($event)"
            (cancelled)="editing.set(false)"
          />
        } @else {
          <div class="min-w-0 flex-1">
            <h1 class="text-foreground truncate text-2xl font-bold text-balance">
              {{ person.data()?.name || 'Unnamed person' }}
            </h1>
            <div class="flex flex-wrap items-center gap-x-2">
              @if (person.data(); as p) {
                <p class="text-muted-foreground text-sm tabular-nums">
                  {{ p.faceCount | plural: 'photo' }}
                </p>
              }
              @if (isAdmin() && person.data()?.hidden) {
                <span
                  class="rounded bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400"
                >
                  Hidden
                </span>
              }
              @if (isAdmin() && hiddenFromLabel(); as label) {
                <!-- Admin-only: who this person is hidden from. Opens the picker. -->
                <button
                  type="button"
                  class="text-muted-foreground hover:bg-muted focus-visible:ring-ring -mx-1 inline-flex min-h-8 items-center gap-1 rounded px-1 text-xs outline-none focus-visible:ring-2"
                  title="Change who this person is hidden from"
                  (click)="openHideFrom()"
                >
                  <ng-icon hlm size="xs" name="lucideEyeOff" />
                  Hidden from {{ label }}
                </button>
              }
            </div>
          </div>
          @if (isAdmin()) {
            <!-- Admin actions live behind one menu so the header stays one row on mobile. -->
            <div class="relative shrink-0 self-start">
              <button
                type="button"
                class="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring grid size-11 place-items-center rounded-full transition-[background-color,color,scale] duration-150 outline-none focus-visible:ring-2 active:scale-[0.96] sm:size-9"
                aria-label="Person actions"
                aria-haspopup="menu"
                [attr.aria-expanded]="menuOpen()"
                (click)="menuOpen.set(!menuOpen())"
              >
                <ng-icon hlm size="base" name="lucideEllipsis" />
              </button>
              @if (menuOpen()) {
                <div
                  class="fixed inset-0 z-40"
                  aria-hidden="true"
                  (click)="menuOpen.set(false)"
                ></div>
                <div
                  role="menu"
                  aria-label="Person actions"
                  class="glass-strong motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 absolute top-full right-0 z-50 mt-1 flex w-56 origin-top-right flex-col rounded-xl p-1.5"
                  (keydown.escape)="menuOpen.set(false)"
                >
                  <button
                    type="button"
                    role="menuitem"
                    [class]="menuItemClass"
                    (click)="menuAction('rename')"
                  >
                    <ng-icon hlm size="sm" name="lucidePencil" class="text-muted-foreground" />
                    {{ person.data()?.name ? 'Rename' : 'Add a name' }}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    [class]="menuItemClass"
                    (click)="menuAction('merge')"
                  >
                    <ng-icon hlm size="sm" name="lucideMerge" class="text-muted-foreground" />
                    Merge into...
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    [class]="menuItemClass"
                    (click)="menuAction('hideFrom')"
                  >
                    <ng-icon hlm size="sm" name="lucideEyeOff" class="text-muted-foreground" />
                    Hide from...
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    [class]="menuItemClass"
                    [disabled]="busy()"
                    (click)="menuAction('toggleHidden')"
                  >
                    <ng-icon
                      hlm
                      size="sm"
                      [name]="person.data()?.hidden ? 'lucideEye' : 'lucideEyeOff'"
                      class="text-muted-foreground"
                    />
                    {{ person.data()?.hidden ? 'Unhide person' : 'Hide person' }}
                  </button>
                </div>
              }
            </div>
          }
        }
      </div>

      <!-- Admin-only curation: merge this person into another, and hide/unhide
           (hiding also removes their photos from the gallery, timeline and map).
           Each change shows a toast with Undo. -->
      @if (isAdmin()) {
        @if (mergeOpen()) {
          <div class="bg-muted/40 mb-3 flex flex-wrap items-center gap-2 rounded-lg border p-2">
            @if (!selectedTarget()) {
              <!-- Pick a person to merge into. Clicking a row goes to the confirm step. -->
              <div class="flex w-full max-w-sm flex-col gap-2">
                <div class="flex items-center gap-2">
                  <input
                    hlmInput
                    type="search"
                    class="h-11 flex-1 text-sm sm:h-9"
                    [ngModel]="mergeSearch()"
                    (ngModelChange)="mergeSearch.set($event)"
                    placeholder="Merge into... type to search people"
                    aria-label="Search people to merge into"
                    autofocus
                  />
                  <button hlmBtn variant="ghost" class="h-11 sm:h-9" (click)="closeMerge()">
                    Cancel
                  </button>
                </div>
                <div class="bg-background max-h-56 divide-y overflow-y-auto rounded-md border">
                  @for (p of mergeTargets(); track p.id) {
                    <button
                      type="button"
                      class="hover:bg-muted focus-visible:bg-muted flex min-h-11 w-full items-center gap-2 px-2 py-1.5 text-left text-sm outline-none"
                      (click)="mergeTargetId.set(p.id)"
                    >
                      <span class="bg-muted relative h-8 w-8 shrink-0 overflow-hidden rounded-full">
                        @if (p.coverFaceId) {
                          <img
                            class="h-full w-full object-cover"
                            [src]="apiUrl + '/face/' + p.coverFaceId"
                            alt=""
                            loading="lazy"
                          />
                        } @else {
                          <span class="text-muted-foreground grid h-full w-full place-items-center">
                            <ng-icon hlm size="sm" name="lucideUser" />
                          </span>
                        }
                      </span>
                      <span class="truncate">{{ p.name }}</span>
                      <span class="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums">
                        {{ p.faceCount | plural: 'photo' }}
                      </span>
                    </button>
                  } @empty {
                    <p class="text-muted-foreground px-2 py-2 text-sm">No matching people.</p>
                  }
                </div>
              </div>
            } @else if (selectedTarget(); as t) {
              <div class="flex w-full max-w-md flex-wrap items-center gap-2">
                <span class="bg-muted relative h-8 w-8 shrink-0 overflow-hidden rounded-full">
                  @if (t.coverFaceId) {
                    <img
                      class="h-full w-full object-cover"
                      [src]="apiUrl + '/face/' + t.coverFaceId"
                      [alt]="faceAlt(t.name)"
                      loading="lazy"
                    />
                  }
                </span>
                <span class="text-sm">
                  Merge into <strong>{{ t.name }}</strong
                  >?
                  <span class="text-muted-foreground">You can undo this for 10 minutes.</span>
                </span>
                <div class="ml-auto flex gap-2">
                  <button
                    hlmBtn
                    class="h-11 active:scale-[0.96] sm:h-8"
                    (click)="mergeInto(t)"
                    [disabled]="busy()"
                  >
                    {{ busy() ? 'Merging' : 'Merge' }}
                  </button>
                  <button
                    hlmBtn
                    variant="ghost"
                    class="h-11 sm:h-8"
                    [disabled]="busy()"
                    (click)="mergeTargetId.set('')"
                  >
                    Back
                  </button>
                </div>
              </div>
            }
          </div>
        }

        @if (reviewCount() > 0) {
          <div
            class="bg-primary/5 border-primary/20 mb-3 flex flex-wrap items-center gap-3 rounded-lg border p-2 pl-3"
          >
            <ng-icon hlm size="sm" name="lucideScanFace" class="text-primary" />
            <p class="text-foreground text-sm">
              <span class="font-medium tabular-nums">{{ reviewCountLabel() }}</span>
              {{ reviewCount() === 1 ? 'face' : 'faces' }} to review: is this
              {{ person.data()?.name || 'this person' }}?
            </p>
            <button
              hlmBtn
              class="ml-auto h-11 active:scale-[0.96] sm:h-8"
              (click)="reviewOpen.set(true)"
            >
              Review
            </button>
          </div>
        }
      }

      <div role="tablist" aria-label="Show" class="bg-muted mb-3 inline-flex w-fit rounded-lg p-1">
        @for (t of tabs; track t.id) {
          <button
            type="button"
            role="tab"
            [id]="'person-tab-' + t.id"
            [attr.aria-selected]="tab() === t.id"
            [attr.aria-controls]="'person-panel-' + t.id"
            [attr.tabindex]="tab() === t.id ? 0 : -1"
            class="focus-visible:ring-ring min-h-11 rounded-md px-4 text-sm font-medium transition-[background-color,color] duration-150 outline-none focus-visible:ring-2 sm:min-h-8"
            [class]="
              tab() === t.id
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            "
            (click)="tab.set(t.id)"
            (keydown.arrowRight)="switchTab()"
            (keydown.arrowLeft)="switchTab()"
          >
            {{ t.label }}
          </button>
        }
      </div>

      @if (tab() === 'photos') {
        <app-virtual-thumbnail-grid
          id="person-panel-photos"
          role="tabpanel"
          aria-labelledby="person-tab-photos"
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
        <app-selection-bar />
      } @else {
        <div
          #facesPanel
          id="person-panel-faces"
          role="tabpanel"
          aria-labelledby="person-tab-faces"
          class="min-h-0 flex-1 overflow-y-auto"
        >
          <app-person-faces
            [personId]="id()"
            [name]="person.data()?.name ?? null"
            [isAdmin]="isAdmin()"
            [scrollRoot]="facesPanel"
          />
        </div>
      }
    }

    @if (reviewOpen()) {
      <app-face-review [personId]="id()" (closed)="reviewOpen.set(false)" />
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
  private readonly dialog = inject(HlmDialogService);
  private readonly actions = inject(FaceActions);

  // False while the admin previews as another user, so the page looks exactly
  // as that user sees it.
  protected readonly isAdmin = this.auth.isAdmin;
  protected readonly faceAlt = faceAlt;

  protected readonly tabs: { id: Tab; label: string }[] = [
    { id: 'photos', label: 'Photos' },
    { id: 'faces', label: 'Faces' },
  ];
  protected readonly tab = signal<Tab>('photos');
  private readonly selection = inject(GridSelection);
  // The photo selection belongs to the Photos tab; leaving it drops the selection.
  private readonly clearSelectionOnTab = effect(() => {
    if (this.tab() !== 'photos') this.selection.clear();
  });

  protected readonly editing = signal(false);
  protected readonly busy = signal(false);
  protected readonly reviewOpen = signal(false);

  // Merge controls stay collapsed behind a "Merge..." button until the admin
  // opens them, so the toolbar stays calm for the common view/rename case.
  protected readonly mergeOpen = signal(false);
  protected readonly menuOpen = signal(false);
  protected readonly menuItemClass =
    'hover:bg-glass-tint focus-visible:bg-glass-tint flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm outline-none transition-[background-color,scale] duration-100 active:scale-[0.98] disabled:opacity-50 sm:min-h-9';

  protected menuAction(action: 'rename' | 'merge' | 'hideFrom' | 'toggleHidden'): void {
    this.menuOpen.set(false);
    if (action === 'rename') this.editing.set(true);
    else if (action === 'merge') this.mergeOpen.set(true);
    else if (action === 'hideFrom') this.openHideFrom();
    else this.toggleHidden();
  }
  protected readonly mergeTargetId = signal<string>('');
  protected readonly mergeSearch = signal('');

  protected readonly apiUrl = environment.api.url;

  fromPath = computed(() => `/faces/${this.id()}`);
  scrollKey = computed(() => `face-${this.id()}`);

  person = injectQuery(() => ({
    queryKey: [CacheKey.FaceSingle, this.id()],
    queryFn: async () => this.trpc.faces.getPerson.query(this.id()),
  }));

  // Other people this cluster can be merged into. Admin-only, so include hidden
  // clusters too. Shares its cache entry with the "Add a name" autocomplete.
  private readonly peopleList = injectQuery(() => ({
    queryKey: [CacheKey.FacesAll, 'merge-targets'],
    queryFn: async () => this.trpc.faces.listPeople.query({ includeHidden: true }),
    enabled: this.isAdmin() && (this.mergeOpen() || this.editing()),
  }));

  protected readonly mergeTargets = computed(() => {
    // Param is typed explicitly: in the production build the tRPC router type
    // can resolve to `any`, so relying on inference here trips noImplicitAny.
    const people = (this.peopleList.data() ?? []) as PersonSummary[];
    const query = this.mergeSearch().trim().toLowerCase();
    return people.filter(
      (p: PersonSummary) =>
        // Only named people are offered: merging into an unnamed person is
        // rarely the intent (merge the unnamed one into this person instead).
        p.id !== this.id() && !!p.name && (query === '' || p.name.toLowerCase().includes(query)),
    );
  });

  // The chosen merge target, shown with its avatar in the confirm step.
  protected readonly selectedTarget = computed(() => {
    const id = this.mergeTargetId();
    if (!id) return null;
    const people = (this.peopleList.data() ?? []) as PersonSummary[];
    return people.find((p: PersonSummary) => p.id === id) ?? null;
  });

  // Admin-only "Is this X?" queue for this person. Same key and limit as the
  // review panel, so opening it shows the same items with no new request.
  private readonly review = injectQuery(() => ({
    queryKey: reviewQueryKey(this.id()),
    queryFn: async () =>
      this.trpc.faces.listConfirmCandidates.query({ personId: this.id(), limit: REVIEW_LIMIT }),
    enabled: this.isAdmin(),
  }));
  protected readonly reviewCount = computed(() => this.review.data()?.length ?? 0);
  protected readonly reviewCountLabel = computed(() => reviewCountText(this.reviewCount()));

  // Admin-only: the users this person is hidden from, for the header label.
  // Shares its cache keys with the "Hide from..." picker, so a save updates it.
  private readonly viewers = injectQuery(() => ({
    queryKey: viewerRulesKeys.viewers(),
    queryFn: async (): Promise<Viewer[]> => this.trpc.viewerRules.viewers.query(),
    enabled: this.isAdmin(),
  }));

  private readonly personRules = injectQuery(() => ({
    queryKey: viewerRulesKeys.person(this.id()),
    queryFn: async (): Promise<{ hiddenFromUserIds: string[] }> =>
      this.trpc.viewerRules.forPerson.query({ personId: this.id() }),
    enabled: this.isAdmin(),
  }));

  protected readonly hiddenFromLabel = computed(() => {
    const ids = new Set(this.personRules.data()?.hiddenFromUserIds ?? []);
    const names = (this.viewers.data() ?? []).filter((v) => ids.has(v.id)).map((v) => v.name);
    return joinNames(names);
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

  // Optimistic rename: the heading and people list update at once, roll back
  // on failure, and reconcile with the background refetch in onSettled.
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
            (old as PersonSummary[] | undefined)?.map((p) => (p.id === id ? { ...p, name } : p)),
        },
      ]);
    },
    onError: (_err, _name, ctx) => ctx?.rollback(),
    onSettled: () => {
      this.queryClient.invalidateQueries({ queryKey: [CacheKey.FaceSingle, this.id()] });
      this.queryClient.invalidateQueries({ queryKey: [CacheKey.FacesAll] });
      this.queryClient.invalidateQueries({ queryKey: [CacheKey.FacesPage] });
      this.queryClient.invalidateQueries({ queryKey: [CacheKey.FaceReview] });
      // The asset viewer's People chips show this name.
      this.queryClient.invalidateQueries({ queryKey: [CacheKey.AssetSingle] });
    },
  }));

  allItems = computed(() => {
    const data = this.files.data();
    if (!data) return [];
    return data.pages.flatMap((page) => page.items);
  });

  saveName(name: string | null): void {
    this.editing.set(false);
    this.rename.mutate(name);
  }

  switchTab(): void {
    const next: Tab = this.tab() === 'photos' ? 'faces' : 'photos';
    this.tab.set(next);
    queueMicrotask(() => document.getElementById(`person-tab-${next}`)?.focus());
  }

  async toggleHidden(): Promise<void> {
    if (this.busy()) return;
    const id = this.id();
    const name = this.person.data()?.name ?? null;
    this.busy.set(true);
    try {
      if (this.person.data()?.hidden) await this.actions.unhide(id, name);
      else await this.actions.hide(id, name);
    } finally {
      this.busy.set(false);
    }
  }

  openHideFrom(): void {
    const target: HideFromTarget = {
      kind: 'person',
      personId: this.id(),
      personName: this.person.data()?.name ?? null,
    };
    this.dialog.open(HideFromDialog, { context: { target } });
  }

  closeMerge(): void {
    this.mergeOpen.set(false);
    this.mergeTargetId.set('');
    this.mergeSearch.set('');
  }

  // Fold this person into target, then show the target. Undo comes back here.
  async mergeInto(target: Pick<PickerPerson, 'id' | 'name'>): Promise<void> {
    if (this.busy()) return;
    this.editing.set(false);
    const sourceId = this.id();
    this.busy.set(true);
    try {
      await this.actions.merge(target.id, sourceId, `Merged into ${target.name || 'that person'}`, {
        done: () => {
          this.closeMerge();
          void this.router.navigate(['/faces', target.id]);
        },
        undone: () => void this.router.navigate(['/faces', sourceId]),
      });
    } finally {
      this.busy.set(false);
    }
  }

  loadMore(): void {
    if (this.files.hasNextPage() && !this.files.isFetchingNextPage()) {
      this.files.fetchNextPage();
    }
  }
}
