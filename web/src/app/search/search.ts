import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AssetThumbnail } from '@core/components/asset-thumbnail/asset-thumbnail';
import { ErrorAlert } from '@core/components/error/error';
import { PluralPipe } from '@core/pipes/plural.pipe';
import { injectTrpc } from '@core/services/trpc';
import { ViewerSequence } from '@core/services/viewer-sequence/viewer-sequence';
import { environment } from '@env/environment';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCalendar,
  lucideCamera,
  lucideHistory,
  lucideImages,
  lucideMapPin,
  lucideSearch,
  lucideSearchX,
  lucideUser,
} from '@ng-icons/lucide';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { injectInfiniteQuery, injectQuery, keepPreviousData } from '@tanstack/angular-query-experimental';
import { map } from 'rxjs';
import { SearchBox } from './search-box';
import { SearchState, searchLinks } from './search-state';

@Component({
  selector: 'app-search',
  imports: [SearchBox, AssetThumbnail, ErrorAlert, RouterLink, NgIcon, HlmIcon, HlmSpinner, PluralPipe],
  providers: [
    provideIcons({
      lucideSearch,
      lucideSearchX,
      lucideHistory,
      lucideMapPin,
      lucideCamera,
      lucideCalendar,
      lucideImages,
      lucideUser,
    }),
  ],
  host: { class: 'flex min-h-0 flex-1 flex-col' },
  template: `
    <div class="mx-auto w-full max-w-2xl shrink-0 pb-3">
      <app-search-box #box [value]="q()" [autofocus]="!q()" />
    </div>

    <div #scroller class="min-h-0 flex-1 overflow-y-auto">
      @if (!q()) {
        <!-- Empty state: recent searches and what can be searched. -->
        <div class="mx-auto flex max-w-2xl flex-col gap-6 py-4">
          @if (state.recent().length) {
            <section>
              <h2 class="text-muted-foreground mb-2 text-sm font-medium">Recent searches</h2>
              <div class="flex flex-wrap gap-2">
                @for (r of state.recent(); track r) {
                  <a
                    [routerLink]="['/search']"
                    [queryParams]="{ q: r }"
                    class="bg-muted hover:bg-accent inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-sm transition-[background-color,scale] duration-100 active:scale-[0.96]"
                  >
                    <ng-icon hlm size="xs" name="lucideHistory" class="text-muted-foreground" />
                    {{ r }}
                  </a>
                }
              </div>
            </section>
          }
          <section class="text-muted-foreground flex flex-col items-center gap-2 py-10 text-center">
            <ng-icon hlm size="xl" name="lucideSearch" />
            <p class="text-foreground font-medium">Search your library</p>
            <p class="max-w-sm text-sm text-pretty">
              Search by person, place, album, camera, file name, year or month. Combine them, for
              example "Steve 2019" or "Paris June".
            </p>
            <p class="hidden text-xs sm:block">
              Press <kbd class="bg-muted rounded px-1 font-sans">/</kbd> anywhere to search.
            </p>
          </section>
        </div>
      } @else {
        @let groups = suggest.data();

        @if (groups) {
          <!-- People -->
          @if (groups.people.length) {
            <section class="mb-6" aria-labelledby="search-people">
              <h2 id="search-people" class="mb-3 text-base font-semibold">People</h2>
              <div class="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
                @for (p of groups.people; track p.id) {
                  <a
                    [routerLink]="links.person(p.id)"
                    class="flex w-20 shrink-0 flex-col items-center gap-1.5 text-center transition-transform duration-100 active:scale-[0.96] sm:w-24"
                  >
                    @if (p.coverFaceId) {
                      <img
                        [src]="apiUrl + '/face/' + p.coverFaceId"
                        alt=""
                        class="size-20 rounded-full object-cover outline outline-1 -outline-offset-1 outline-black/10 sm:size-24 dark:outline-white/10"
                        loading="lazy"
                      />
                    } @else {
                      <span class="bg-muted text-muted-foreground grid size-20 place-items-center rounded-full sm:size-24">
                        <ng-icon hlm name="lucideUser" />
                      </span>
                    }
                    <span class="w-full truncate text-sm font-medium">{{ p.name }}</span>
                    <span class="text-muted-foreground -mt-1 text-xs tabular-nums">{{ p.count | plural: 'photo' }}</span>
                  </a>
                }
              </div>
            </section>
          }

          <!-- Places, albums, cameras and dates share one row of cards. -->
          @if (groups.places.length || groups.albums.length || groups.cameras.length || groups.dates.length) {
            <section class="mb-6 flex flex-col gap-6 lg:flex-row lg:flex-wrap">
              @if (groups.places.length) {
                <div class="min-w-0 lg:flex-1">
                  <h2 class="mb-3 text-base font-semibold">Places</h2>
                  <ul class="flex flex-col gap-1">
                    @for (pl of groups.places; track pl.name) {
                      <li>
                        <a
                          [routerLink]="links.place(pl.lat, pl.lon)"
                          class="hover:bg-accent flex min-h-12 items-center gap-3 rounded-lg p-1.5 transition-[background-color,scale] duration-100 active:scale-[0.98]"
                        >
                          @if (pl.cover) {
                            <img [src]="apiUrl + '/asset/' + pl.cover + '/thumbnail'" alt="" class="size-10 rounded-md object-cover outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10" loading="lazy" />
                          } @else {
                            <span class="bg-muted text-muted-foreground grid size-10 place-items-center rounded-md"><ng-icon hlm size="sm" name="lucideMapPin" /></span>
                          }
                          <span class="min-w-0">
                            <span class="block truncate text-sm font-medium">{{ pl.name }}</span>
                            <span class="text-muted-foreground block truncate text-xs tabular-nums">{{ pl.country }} · {{ pl.count | plural: 'item' }}</span>
                          </span>
                        </a>
                      </li>
                    }
                  </ul>
                </div>
              }
              @if (groups.albums.length) {
                <div class="min-w-0 lg:flex-1">
                  <h2 class="mb-3 text-base font-semibold">Albums</h2>
                  <ul class="flex flex-col gap-1">
                    @for (al of groups.albums; track al.id) {
                      <li>
                        <a
                          [routerLink]="links.album(al.id)"
                          class="hover:bg-accent flex min-h-12 items-center gap-3 rounded-lg p-1.5 transition-[background-color,scale] duration-100 active:scale-[0.98]"
                        >
                          @if (al.cover) {
                            <img [src]="apiUrl + '/asset/' + al.cover + '/thumbnail'" alt="" class="size-10 rounded-md object-cover outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10" loading="lazy" />
                          } @else {
                            <span class="bg-muted text-muted-foreground grid size-10 place-items-center rounded-md"><ng-icon hlm size="sm" name="lucideImages" /></span>
                          }
                          <span class="min-w-0">
                            <span class="block truncate text-sm font-medium">{{ al.name }}</span>
                            <span class="text-muted-foreground block text-xs tabular-nums">{{ al.items | plural: 'item' }}</span>
                          </span>
                        </a>
                      </li>
                    }
                  </ul>
                </div>
              }
              @if (groups.cameras.length) {
                <div class="min-w-0 lg:flex-1">
                  <h2 class="mb-3 text-base font-semibold">Cameras</h2>
                  <ul class="flex flex-col gap-1">
                    @for (c of groups.cameras; track c.make + c.model) {
                      <li>
                        <a
                          [routerLink]="links.camera(c.make, c.model)"
                          class="hover:bg-accent flex min-h-12 items-center gap-3 rounded-lg p-1.5 transition-[background-color,scale] duration-100 active:scale-[0.98]"
                        >
                          <span class="bg-muted text-muted-foreground grid size-10 place-items-center rounded-md"><ng-icon hlm size="sm" name="lucideCamera" /></span>
                          <span class="min-w-0">
                            <span class="block truncate text-sm font-medium">{{ c.make }} {{ c.model }}</span>
                            <span class="text-muted-foreground block text-xs tabular-nums">{{ c.count | plural: 'photo' }}</span>
                          </span>
                        </a>
                      </li>
                    }
                  </ul>
                </div>
              }
              @if (groups.dates.length) {
                <div class="min-w-0 lg:flex-1">
                  <h2 class="mb-3 text-base font-semibold">Dates</h2>
                  <div class="flex flex-wrap gap-2">
                    @for (d of groups.dates; track d.label) {
                      @if (d.year !== null && d.month === null) {
                        <a
                          [routerLink]="links.year(d.year)"
                          class="bg-muted hover:bg-accent inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-sm tabular-nums transition-[background-color,scale] duration-100 active:scale-[0.96]"
                        >
                          <ng-icon hlm size="xs" name="lucideCalendar" class="text-muted-foreground" />
                          All of {{ d.label }}
                        </a>
                      } @else {
                        <span class="bg-muted inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-sm tabular-nums">
                          <ng-icon hlm size="xs" name="lucideCalendar" class="text-muted-foreground" />
                          {{ d.label }}
                        </span>
                      }
                    }
                  </div>
                </div>
              }
            </section>
          }
        }

        <!-- Photos for the combined query. -->
        <section aria-labelledby="search-photos">
          <div class="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h2 id="search-photos" class="text-base font-semibold">Photos</h2>
            @if (filters().length) {
              <p class="text-muted-foreground text-sm">
                @for (f of filters(); track f.kind + f.label; let last = $last) {
                  <span class="text-foreground font-medium">{{ f.label }}</span>@if (!last) {<span> and </span>}
                }
              </p>
            }
          </div>

          @if (photos.isPending()) {
            <div class="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-1 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] sm:gap-2" aria-busy="true" aria-label="Loading photos">
              @for (i of skeleton; track i) {
                <div class="bg-muted aspect-square animate-pulse rounded-lg"></div>
              }
            </div>
          } @else if (photos.isError() && !items().length) {
            <app-error-alert [error]="photos.error()" [retry]="retryPhotos" />
          } @else if (!items().length) {
            <div class="text-muted-foreground flex flex-col items-center gap-2 py-12 text-center">
              <ng-icon hlm size="xl" name="lucideSearchX" />
              <p class="text-foreground font-medium">No photos match "{{ q() }}"</p>
              <p class="max-w-sm text-sm text-pretty">
                Check the spelling, or use fewer words. Each word must match a person, place,
                album, camera, file name or date.
              </p>
            </div>
          } @else {
            <div
              class="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-1 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] sm:gap-2"
              (click)="rememberReturn()"
            >
              @for (asset of items(); track asset.id) {
                <app-asset-thumbnail [asset]="asset" from="/search" [seq]="seqToken()" />
              }
            </div>
            <div #sentinel class="flex h-16 items-center justify-center">
              @if (photos.isFetchingNextPage()) {
                <hlm-spinner class="size-5" />
              }
            </div>
          }
        </section>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Search {
  private readonly trpc = injectTrpc();
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly state = inject(SearchState);
  protected readonly apiUrl = environment.api.url;
  protected readonly links = searchLinks;
  protected readonly skeleton = Array.from({ length: 18 }, (_, i) => i);

  private readonly box = viewChild.required<SearchBox>('box');
  private readonly sentinel = viewChild<ElementRef<HTMLElement>>('sentinel');
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  protected readonly q = toSignal(
    this.route.queryParamMap.pipe(map((p) => (p.get('q') ?? '').trim())),
    { initialValue: (this.route.snapshot.queryParamMap.get('q') ?? '').trim() },
  );

  protected readonly suggest = injectQuery(() => ({
    queryKey: ['search', 'groups', this.q()],
    queryFn: () => this.trpc.search.suggest.query({ q: this.q(), limit: 12 }),
    enabled: this.q().length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  }));

  protected readonly photos = injectInfiniteQuery(() => ({
    queryKey: ['search', 'photos', this.q()],
    queryFn: ({ pageParam }) =>
      this.trpc.search.photos.query({ q: this.q(), limit: 60, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: this.q().length > 0,
    staleTime: 30_000,
  }));

  protected readonly items = computed(() => this.photos.data()?.pages.flatMap((p) => p.items) ?? []);

  // The viewer walks the result list (not the whole library) with prev / next.
  private readonly sequence = inject(ViewerSequence);
  // A new token for each query, so an older viewer tab keeps its own list.
  protected readonly seqToken = computed(() => {
    this.q();
    return this.sequence.newToken();
  });
  protected readonly filters = computed(() => this.photos.data()?.pages[0]?.filters ?? []);

  protected readonly retryPhotos = () => this.photos.refetch();

  constructor() {
    // Back from the photo viewer: its back link is plain "/search", so put the
    // last query back.
    if (!this.q()) {
      const prev =
        this.router.getCurrentNavigation()?.previousNavigation?.finalUrl?.toString() ??
        this.router.lastSuccessfulNavigation?.finalUrl?.toString() ??
        '';
      const saved = this.state.takeReturnQuery();
      if (prev.startsWith('/asset/') && saved) {
        void this.router.navigate(['/search'], { queryParams: { q: saved }, replaceUrl: true });
      }
    }

    effect(() => {
      const q = this.q();
      if (q) untracked(() => this.state.remember(q));
      untracked(() => this.scroller()?.nativeElement.scrollTo({ top: 0 }));
    });

    effect(() => {
      const ids = this.items().map((a) => a.id);
      const token = this.seqToken();
      untracked(() => this.sequence.set(token, ids));
    });

    effect(() => {
      if (this.state.focusRequest() > 0) untracked(() => this.box().focus());
    });

    // Load the next page when the end of the grid comes into view.
    const destroyRef = inject(DestroyRef);
    let observer: IntersectionObserver | null = null;
    effect(() => {
      const el = this.sentinel()?.nativeElement;
      // Re-observe after each page, so a sentinel that stays in view still
      // loads the next page.
      this.items().length;
      observer?.disconnect();
      if (!el || typeof IntersectionObserver === 'undefined') return;
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting) && this.photos.hasNextPage() && !this.photos.isFetchingNextPage()) {
            void this.photos.fetchNextPage();
          }
        },
        { root: this.scroller()?.nativeElement ?? null, rootMargin: '800px 0px' },
      );
      observer.observe(el);
    });
    destroyRef.onDestroy(() => observer?.disconnect());
  }

  protected rememberReturn() {
    this.state.setReturnQuery(this.q());
  }
}
