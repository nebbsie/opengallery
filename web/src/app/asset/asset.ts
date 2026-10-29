import { DatePipe, Location } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ErrorAlert } from '@core/components/error/error';
import { ShareItem } from '@core/dialogs/share-item/share-item';
import { Auth } from '@core/services/auth/auth';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { ViewerSequence } from '@core/services/viewer-sequence/viewer-sequence';
import { environment } from '@env/environment';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideChevronLeft,
  lucideChevronRight,
  lucideDownload,
  lucideEyeOff,
  lucideInfo,
  lucideMaximize,
  lucideMinimize,
  lucideRotateCw,
  lucideScanFace,
  lucideShare2,
  lucideSquareDashedMousePointer,
  lucideX,
} from '@ng-icons/lucide';
import { RotationService } from '@core/services/rotation/rotation';
import { ToastService } from '@core/services/toast/toast';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { injectQuery, keepPreviousData, QueryClient } from '@tanstack/angular-query-experimental';
import { HideFromDialog, HideFromTarget } from '../shared-viewer/hide-from-dialog/hide-from-dialog';
import { FileRules, joinNames, Viewer, viewerRulesKeys } from '../shared-viewer/viewer-rules';
import { assetDate, formatBytes, formatCoords } from './asset-format';
import { AssetInfoPanel, ViewFileData } from './info-panel';
import { StageSlot, ViewerStage } from './viewer-stage';

const INFO_OPEN_STORAGE_KEY = 'asset.infoOpen';
// Live Photos move when shown ('0' = off, the still only; on by default).
const LIVE_AUTO_STORAGE_KEY = 'asset.livePhotos';

@Component({
  selector: 'app-asset',
  imports: [ErrorAlert, RouterLink, NgIcon, HlmButton, HlmIcon, DatePipe, AssetInfoPanel, ViewerStage],
  providers: [
    provideIcons({
      lucideChevronLeft,
      lucideChevronRight,
      lucideDownload,
      lucideEyeOff,
      lucideInfo,
      lucideMaximize,
      lucideMinimize,
      lucideRotateCw,
      lucideScanFace,
      lucideShare2,
      lucideSquareDashedMousePointer,
      lucideX,
    }),
  ],
  host: {
    class: 'relative flex h-full w-full flex-col overflow-hidden sm:flex-row',
    '[style.background-color]': "'rgba(0, 0, 0, ' + (1 - dismissProgress()) + ')'",
    '(document:keydown)': 'onKeydown($event)',
    '(document:fullscreenchange)': 'isFullscreen.set(!!fullscreenElement())',
  },
  template: `
    <!-- Media area -->
    <div class="relative min-h-0 min-w-0 flex-1" role="region" aria-label="Photo viewer">
      <app-viewer-stage
        [slots]="slots()"
        [alt]="alt()"
        [showFaces]="showFaces()"
        [(tagMode)]="tagMode"
        [motionUrl]="motionUrl()"
        [liveOn]="liveAuto()"
        (navigate)="go($event)"
        (dismiss)="close()"
        (tapped)="chromeVisible.set(!chromeVisible())"
        (swipeUp)="infoOpen.set(true)"
      />

      @if (file.isError()) {
        <div class="absolute inset-x-4 top-20 z-30 mx-auto max-w-md">
          <app-error-alert [error]="file.error()" />
        </div>
      }

      <!-- Controls. They fade while the photo is dragged down and hide on a tap. -->
      <div
        class="pointer-events-none absolute inset-0 z-20 transition-opacity duration-200"
        [style.opacity]="chromeOpacity()"
        [class.invisible]="chromeOpacity() === 0"
      >
        <!-- Scrim so the controls stay legible over bright photos -->
        <div
          class="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/50 to-transparent"
          aria-hidden="true"
        ></div>

        <div class="pointer-events-auto absolute inset-x-0 top-0 flex items-center gap-1 p-1.5 sm:p-2">
          <button
            hlmBtn
            variant="ghost"
            size="icon"
            type="button"
            [class]="ctrlBtn"
            aria-label="Close"
            title="Close (Esc)"
            (click)="close()"
          >
            <ng-icon hlm name="lucideX" />
          </button>

          <!-- When the item was taken (or imported), and where -->
          <div class="min-w-0 flex-1 px-1 text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.5)]">
            @if (date(); as d) {
              <p class="truncate text-sm leading-tight font-medium tabular-nums">
                {{ d | date: 'EEE, MMM d, y' }}
              </p>
              <p class="truncate text-xs leading-tight text-white/75 tabular-nums">
                {{ d | date: 'h:mm a' }}@if (coords()) {
                  · {{ coords() }}
                }
              </p>
            }
          </div>

          @if (current()?.motion) {
            <!-- Live Photo. On: the video loops over the still. Off: the still. -->
            <button
              type="button"
              [class]="(liveAuto() ? ctrlBtnOn : ctrlBtn) + ' !w-auto px-3 text-xs font-bold tracking-wider'"
              [attr.aria-pressed]="liveAuto()"
              aria-label="Live Photos"
              [title]="liveAuto() ? 'Live Photos on. Tap to show the still photo' : 'Live Photos off. Tap to play them'"
              (click)="toggleLive()"
            >
              LIVE
            </button>
          }

          @if (current()?.canRotate) {
            <button
              hlmBtn
              variant="ghost"
              size="icon"
              type="button"
              [class]="ctrlBtn"
              aria-label="Rotate clockwise"
              title="Rotate (R)"
              (click)="rotate()"
            >
              <ng-icon hlm name="lucideRotateCw" />
            </button>
          }

          @if (current()?.file?.type === 'image' || (!current() && slotType() !== 'video')) {
            <button
              hlmBtn
              variant="ghost"
              size="icon"
              type="button"
              [class]="showFaces() ? ctrlBtnOn : ctrlBtn"
              [attr.aria-pressed]="showFaces()"
              aria-label="Show people"
              title="People (P)"
              (click)="toggleFaces()"
            >
              <ng-icon hlm name="lucideScanFace" />
            </button>
          }

          @if (current()?.raw?.paired) {
            <!-- RAW + JPEG: choose which file to download. -->
            <div class="relative">
              <button
                hlmBtn
                variant="ghost"
                size="icon"
                type="button"
                [class]="downloadMenuOpen() ? ctrlBtnOn : ctrlBtn"
                aria-haspopup="menu"
                [attr.aria-expanded]="downloadMenuOpen()"
                aria-label="Download"
                title="Download"
                (click)="downloadMenuOpen.set(!downloadMenuOpen())"
              >
                <ng-icon hlm name="lucideDownload" />
              </button>
              @if (downloadMenuOpen()) {
                <!-- Tap outside closes the menu. -->
                <div class="fixed inset-0 z-30" aria-hidden="true" (click)="downloadMenuOpen.set(false)"></div>
                <div
                  role="menu"
                  aria-label="Download"
                  class="absolute top-12 right-0 z-40 w-56 overflow-hidden rounded-xl bg-black/80 py-1 text-sm text-white shadow-lg backdrop-blur-md"
                >
                  <a
                    role="menuitem"
                    class="flex min-h-11 items-center justify-between gap-3 px-3 outline-none hover:bg-white/10 focus-visible:bg-white/15"
                    [href]="apiUrl + '/asset/' + id() + '?download=1'"
                    [attr.download]="current()?.file?.name ?? ''"
                    (click)="downloadMenuOpen.set(false)"
                  >
                    <span>JPEG</span>
                    <span class="text-xs text-white/60 tabular-nums">{{ bytes(current()?.file?.size) }}</span>
                  </a>
                  <a
                    role="menuitem"
                    class="flex min-h-11 items-center justify-between gap-3 px-3 outline-none hover:bg-white/10 focus-visible:bg-white/15"
                    [href]="apiUrl + '/asset/' + id() + '/raw?download=1'"
                    [attr.download]="current()?.raw?.name ?? ''"
                    (click)="downloadMenuOpen.set(false)"
                  >
                    <span>RAW</span>
                    <span class="text-xs text-white/60 tabular-nums">{{ bytes(current()?.raw?.size) }}</span>
                  </a>
                </div>
              }
            </div>
          } @else {
            <a
              hlmBtn
              variant="ghost"
              size="icon"
              [class]="ctrlBtn"
              [href]="apiUrl + '/asset/' + id()"
              [attr.download]="current()?.file?.name ?? ''"
              aria-label="Download original"
              title="Download original"
            >
              <ng-icon hlm name="lucideDownload" />
            </a>
          }

          @if (current()?.canManageShares) {
            <button
              hlmBtn
              variant="ghost"
              size="icon"
              type="button"
              [class]="ctrlBtn"
              aria-label="Share"
              title="Share"
              (click)="openShareDialog()"
            >
              <ng-icon hlm name="lucideShare2" />
            </button>
          }

          @if (isAdmin() && current()) {
            <button
              hlmBtn
              variant="ghost"
              size="icon"
              type="button"
              [class]="ctrlBtn"
              aria-label="Hide from..."
              title="Hide from..."
              (click)="openHideFromDialog()"
            >
              <ng-icon hlm name="lucideEyeOff" />
            </button>
          }

          <button
            hlmBtn
            variant="ghost"
            size="icon"
            type="button"
            [class]="ctrlBtn + ' hidden sm:inline-flex'"
            [attr.aria-label]="isFullscreen() ? 'Exit full screen' : 'Full screen'"
            [title]="isFullscreen() ? 'Exit full screen (F)' : 'Full screen (F)'"
            (click)="toggleFullscreen()"
          >
            <ng-icon hlm [name]="isFullscreen() ? 'lucideMinimize' : 'lucideMaximize'" />
          </button>

          <button
            hlmBtn
            variant="ghost"
            size="icon"
            type="button"
            [class]="infoOpen() ? ctrlBtnOn : ctrlBtn"
            [attr.aria-pressed]="infoOpen()"
            aria-label="Info"
            title="Info (I)"
            (click)="infoOpen.set(!infoOpen())"
          >
            <ng-icon hlm name="lucideInfo" />
          </button>
        </div>

        @if (prevId() && !navBlocked()) {
          <a
            hlmBtn
            variant="ghost"
            size="icon"
            [class]="ctrlBtn + ' pointer-events-auto absolute top-1/2 left-3 hidden -translate-y-1/2 sm:inline-flex'"
            [routerLink]="['/asset', prevId()]"
            [queryParams]="navQueryParams()"
            [replaceUrl]="true"
            aria-label="Previous"
            title="Previous"
          >
            <ng-icon hlm name="lucideChevronLeft" />
          </a>
        }
        @if (nextId() && !navBlocked()) {
          <a
            hlmBtn
            variant="ghost"
            size="icon"
            [class]="ctrlBtn + ' pointer-events-auto absolute top-1/2 right-3 hidden -translate-y-1/2 sm:inline-flex'"
            [routerLink]="['/asset', nextId()]"
            [queryParams]="navQueryParams()"
            [replaceUrl]="true"
            aria-label="Next"
            title="Next"
          >
            <ng-icon hlm name="lucideChevronRight" />
          </a>
        }

        @if (showFaces() && isAdmin() && current()?.file?.type === 'image') {
          <div
            class="pointer-events-auto absolute inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom))] flex justify-center"
          >
            <button
              type="button"
              class="flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-medium shadow-lg backdrop-blur-sm transition-[scale,background-color] outline-none focus-visible:ring-2 focus-visible:ring-white active:scale-[0.96]"
              [class]="tagMode() ? 'bg-white text-black' : 'bg-black/60 text-white hover:bg-black/75'"
              [attr.aria-pressed]="tagMode()"
              (click)="tagMode.set(!tagMode())"
            >
              <ng-icon hlm size="sm" name="lucideSquareDashedMousePointer" />
              {{ tagMode() ? 'Cancel tagging' : 'Tag a face' }}
            </button>
          </div>
        }
      </div>
    </div>

    <!-- Info panel. Inert while closed so Tab does not go into hidden controls. -->
    <aside
      class="bg-background text-foreground shrink-0 overflow-hidden transition-[height,width,opacity] duration-200 ease-out"
      aria-label="Info"
      [inert]="!infoOpen()"
      [class]="
        infoOpen()
          ? 'h-[50dvh] w-full border-t pb-[env(safe-area-inset-bottom)] opacity-100 sm:h-full sm:w-96 sm:border-t-0 sm:border-l sm:pb-0'
          : 'h-0 w-full opacity-0 sm:h-full sm:w-0'
      "
    >
      <!-- Only the item on screen: while the next one loads, a skeleton
           shows instead of the previous item's details. -->
      @if (current(); as data) {
        <div class="h-full w-full sm:w-96">
          <app-asset-info-panel
            [data]="data"
            [open]="infoOpen()"
            [hiddenFromLabel]="hiddenFromLabel()"
            (hideFrom)="openHideFromDialog()"
            (closed)="infoOpen.set(false)"
          />
        </div>
      } @else if (!file.isError()) {
        <div class="h-full w-full space-y-3 px-4 pt-4 sm:w-96" aria-busy="true" aria-label="Loading info">
          <div class="bg-muted h-5 w-48 animate-pulse rounded"></div>
          <div class="bg-muted h-4 w-32 animate-pulse rounded"></div>
          <div class="bg-muted mt-6 h-16 w-full animate-pulse rounded-lg"></div>
          <div class="bg-muted h-24 w-full animate-pulse rounded-lg"></div>
        </div>
      }
    </aside>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Asset {
  readonly apiUrl = environment.api.url;

  // Media-overlay controls: a translucent dark circle with a white icon so
  // they stay legible over any photo. 44px tap targets.
  protected readonly ctrlBtn =
    'size-11 rounded-full border-0 bg-black/35 text-white backdrop-blur-sm transition-[scale,background-color] outline-none hover:bg-black/55 hover:text-white focus-visible:ring-2 focus-visible:ring-white active:scale-[0.96]';

  // The same control while its mode is on (People, Info).
  protected readonly ctrlBtnOn =
    'size-11 rounded-full border-0 bg-white text-black transition-[scale,background-color] outline-none hover:bg-white/85 hover:text-black focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black active:scale-[0.96]';

  protected readonly trpc = injectTrpc();
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly location = inject(Location);
  private readonly queryClient = inject(QueryClient);
  private readonly dialog = inject(HlmDialogService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  // False while the admin previews as another user.
  protected readonly isAdmin = inject(Auth).isAdmin;

  private readonly qp = this.route.snapshot.queryParamMap;
  protected readonly backLink = this.qp.get('from');
  protected readonly albumId = this.qp.get('albumId');
  protected readonly cameraMake = this.qp.get('cameraMake');
  protected readonly cameraModel = this.qp.get('cameraModel');
  protected readonly kind = this.qp.get('kind') as 'image' | 'video' | 'all' | null;
  protected readonly personId = this.qp.get('personId');
  // Token of an ordered id list (search results) that prev / next walks
  // instead of the library order.
  protected readonly seq = this.qp.get('seq');
  private readonly sequence = inject(ViewerSequence);
  private readonly sequenceIds = computed(() => this.sequence.get(this.seq));

  // The viewer was opened from another page in this tab, so Back returns to
  // it (with its scroll position). Neighbour moves use replaceUrl, so they do
  // not add history entries.
  private readonly hasInAppHistory = !!this.router.getCurrentNavigation()?.previousNavigation;

  id = input.required<string>();

  protected readonly infoOpen = signal(this.readInfoOpenFromStorage());
  protected readonly showFaces = signal(false);
  protected readonly tagMode = signal(false);
  protected readonly chromeVisible = signal(true);
  protected readonly isFullscreen = signal(false);
  // RAW + JPEG download menu in the top bar.
  protected readonly downloadMenuOpen = signal(false);

  // Live Photos: loop the motion video over the still (per viewer, on by
  // default), or show the still only.
  protected readonly liveAuto = signal(this.readLiveAuto());
  private readonly rotation = inject(RotationService);
  private readonly toast = inject(ToastService);
  protected readonly motionUrl = computed(() => {
    const data = this.current();
    return data?.motion ? `${this.apiUrl}/asset/${data.file.id}/motion` : null;
  });
  protected readonly bytes = formatBytes;

  private readonly stage = viewChild(ViewerStage);
  protected readonly dismissProgress = computed(() => this.stage()?.dismissProgress() ?? 0);
  protected readonly chromeOpacity = computed(() =>
    this.chromeVisible() ? Math.max(0, 1 - this.dismissProgress() * 2) : 0,
  );

  private key(id: string) {
    return [
      CacheKey.AssetSingle,
      id,
      this.albumId,
      this.cameraMake,
      this.cameraModel,
      this.kind,
      this.personId,
    ] as const;
  }

  private fetchFile(id: string): Promise<ViewFileData> {
    return this.trpc.files.viewFile.query({
      fileId: id,
      albumId: this.albumId ?? undefined,
      cameraMake: this.cameraMake ?? undefined,
      cameraModel: this.cameraModel ?? undefined,
      kind: this.kind ?? undefined,
      personId: this.personId ?? undefined,
    });
  }

  // Keeps the previous item while the next one loads, so arrow moves never
  // show a blank screen.
  readonly file = injectQuery(() => ({
    queryKey: this.key(this.id()),
    staleTime: Infinity,
    networkMode: 'offlineFirst' as const,
    placeholderData: keepPreviousData,
    queryFn: () => this.fetchFile(this.id()),
  }));

  // Bumped when a neighbour lands in the cache, so the slots can read it.
  private readonly cacheTick = signal(0);

  private cached(id: string): ViewFileData | undefined {
    return this.queryClient.getQueryData<ViewFileData>(this.key(id));
  }

  /** Data for the item on screen (null while it loads). */
  protected readonly current = computed(() => {
    const data = this.file.data();
    return data && data.file.id === this.id() ? data : null;
  });

  // Neighbours: from the item's own data, or (while it loads) from the item we
  // came from, which is its neighbour on the other side.
  private readonly neighbours = computed(() => {
    const id = this.id();
    const list = this.sequenceIds();
    const at = list ? list.indexOf(id) : -1;
    if (list && at >= 0) {
      return { prevId: list[at - 1] ?? null, nextId: list[at + 1] ?? null };
    }
    this.cacheTick();
    const own = this.current() ?? this.cached(id);
    if (own) return { prevId: own.prevId, nextId: own.nextId };
    const old = this.file.data();
    return {
      prevId: old && old.nextId === id ? old.file.id : null,
      nextId: old && old.prevId === id ? old.file.id : null,
    };
  });
  protected readonly prevId = computed(() => this.neighbours().prevId);
  protected readonly nextId = computed(() => this.neighbours().nextId);

  protected readonly slots = computed<StageSlot[]>(() => {
    const id = this.id();
    this.cacheTick();
    const slot = (sid: string, pos: -1 | 0 | 1): StageSlot => {
      const d = (pos === 0 ? this.current() : null) ?? this.cached(sid);
      const t = d?.file.type;
      return {
        id: sid,
        pos,
        type: t === 'image' || t === 'video' ? t : null,
        mime: d?.file.mime ?? null,
        width: d?.imageMetadata?.width ?? null,
        height: d?.imageMetadata?.height ?? null,
        rotation: d?.file.rotation ?? 0,
      };
    };
    const out: StageSlot[] = [];
    const prev = this.prevId();
    const next = this.nextId();
    if (prev) out.push(slot(prev, -1));
    out.push(slot(id, 0));
    if (next) out.push(slot(next, 1));
    return out;
  });

  /** True while a face tag or the person picker is open in the viewer. */
  protected readonly navBlocked = computed(() => this.stage()?.navBlocked() ?? false);

  protected readonly slotType = computed(() => this.slots().find((s) => s.pos === 0)?.type ?? null);

  protected readonly date = computed(() => assetDate(this.current()));
  protected readonly coords = computed(() => formatCoords(this.current()?.geoLocation ?? null));

  // Alt text: what, when, who and where.
  protected readonly alt = computed(() => {
    const data = this.current();
    if (!data) return 'Photo';
    const parts = [data.file.type === 'video' ? 'Video' : 'Photo'];
    const d = this.date();
    if (d) {
      parts.push(
        `${data.imageMetadata?.takenAt ? 'taken' : 'imported'} on ${d.toLocaleDateString(undefined, { dateStyle: 'long' })}`,
      );
    }
    const names = data.people.map((p) => p.name).filter((n): n is string => !!n);
    if (names.length) parts.push(`with ${joinNames(names)}`);
    if (this.coords()) parts.push(`at ${this.coords()}`);
    return parts.join(' ');
  });

  // Admin only: who cannot see this file (directly or through a hidden person
  // in it), for the info panel. Shares its cache keys with the picker.
  private readonly viewers = injectQuery(() => ({
    queryKey: viewerRulesKeys.viewers(),
    queryFn: async (): Promise<Viewer[]> => this.trpc.viewerRules.viewers.query(),
    enabled: this.isAdmin(),
  }));

  private readonly fileRules = injectQuery(() => ({
    queryKey: viewerRulesKeys.file(this.id()),
    queryFn: async (): Promise<FileRules> => this.trpc.viewerRules.forFile.query({ fileId: this.id() }),
    enabled: this.isAdmin(),
  }));

  protected readonly hiddenFromLabel = computed(() => {
    const rules = this.fileRules.data();
    if (!rules) return '';
    const ids = new Set([...rules.hiddenFromUserIds, ...rules.hiddenViaPerson.map((r) => r.userId)]);
    const names = (this.viewers.data() ?? []).filter((v) => ids.has(v.id)).map((v) => v.name);
    return joinNames(names);
  });

  constructor() {
    // A move to another item closes the download menu.
    effect(() => {
      this.id();
      this.downloadMenuOpen.set(false);
    });

    // Prefetch the neighbours' data and preload their large images.
    effect(() => {
      if (!this.current()) return;
      for (const id of [this.nextId(), this.prevId()]) {
        if (id) void this.prefetch(id);
      }
    });

    // Tagging ends with the People view.
    effect(() => {
      if (!this.showFaces()) this.tagMode.set(false);
    });

    effect(() => {
      const value = this.infoOpen();
      try {
        localStorage.setItem(INFO_OPEN_STORAGE_KEY, value ? '1' : '0');
      } catch {
        // Storage can be blocked; the panel still works.
      }
    });

  }

  protected toggleLive(): void {
    const next = !this.liveAuto();
    this.liveAuto.set(next);
    try {
      localStorage.setItem(LIVE_AUTO_STORAGE_KEY, next ? '1' : '0');
    } catch {
      // Storage can be blocked; the switch still works for this visit.
    }
  }

  // Turn the photo a quarter clockwise. The old image turns at once; the new
  // variants replace it when the worker has made them.
  protected async rotate(): Promise<void> {
    const id = this.current()?.file.id;
    if (!id) return;
    try {
      const res = await this.rotation.rotate([id], 90);
      if (res.failed.length) this.toast.error(res.failed[0]!.reason);
    } catch (err) {
      this.toast.error((err as Error)?.message || 'Could not rotate. Try again.');
    }
  }

  private readLiveAuto(): boolean {
    try {
      return localStorage.getItem(LIVE_AUTO_STORAGE_KEY) !== '0';
    } catch {
      return true;
    }
  }

  private async prefetch(id: string): Promise<void> {
    if (!this.cached(id)) {
      try {
        await this.queryClient.prefetchQuery({
          queryKey: this.key(id),
          queryFn: () => this.fetchFile(id),
          staleTime: 60_000,
        });
      } catch {
        return;
      }
      this.cacheTick.update((n) => n + 1);
    }
    const type = this.cached(id)?.file.type;
    this.preloadUrl(`${this.apiUrl}/asset/${id}/${type === 'image' ? 'optimised' : 'thumbnail'}`);
  }

  private readonly preloaded = new Set<string>();
  private preloadUrl(url: string) {
    if (typeof window === 'undefined' || this.preloaded.has(url)) return;
    this.preloaded.add(url);
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
  }

  protected navQueryParams(): Record<string, string> | null {
    const qp: Record<string, string> = {};
    if (this.albumId) qp['albumId'] = this.albumId;
    if (this.backLink) qp['from'] = this.backLink;
    if (this.cameraMake) qp['cameraMake'] = this.cameraMake;
    if (this.cameraModel) qp['cameraModel'] = this.cameraModel;
    if (this.kind) qp['kind'] = this.kind;
    if (this.personId) qp['personId'] = this.personId;
    if (this.seq) qp['seq'] = this.seq;
    return Object.keys(qp).length ? qp : null;
  }

  protected go(dir: 'prev' | 'next'): void {
    if (this.navBlocked()) return;
    const id = dir === 'prev' ? this.prevId() : this.nextId();
    if (!id) return;
    void this.router.navigate(['/asset', id], {
      queryParams: this.navQueryParams() ?? undefined,
      replaceUrl: true,
    });
  }

  // Back to where the viewer was opened from. With no page before it in this
  // tab (a shared link or a reload), go to the `from` page or the gallery.
  protected close(): void {
    if (this.fullscreenElement()) void document.exitFullscreen().catch(() => undefined);
    if (this.hasInAppHistory) {
      this.location.back();
    } else {
      void this.router.navigateByUrl(this.backLink || '/gallery');
    }
  }

  protected toggleFaces(): void {
    this.showFaces.update((v) => !v);
    this.chromeVisible.set(true);
  }

  protected fullscreenElement(): Element | null {
    return typeof document !== 'undefined' ? document.fullscreenElement : null;
  }

  protected toggleFullscreen(): void {
    if (typeof document === 'undefined') return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void this.host.nativeElement.requestFullscreen?.().catch(() => undefined);
    }
  }

  protected onKeydown(event: KeyboardEvent) {
    // Leave keys to an open dialog (e.g. Share) and to text fields.
    if (event.defaultPrevented || document.querySelector('.cdk-overlay-pane')) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const t = event.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;

    const stage = this.stage();
    let handled = true;
    switch (event.key) {
      case 'Escape':
        if (this.downloadMenuOpen()) this.downloadMenuOpen.set(false);
        else if (!stage?.escape()) this.close();
        break;
      case 'ArrowLeft':
        this.go('prev');
        break;
      case 'ArrowRight':
        this.go('next');
        break;
      case 'i':
      case 'I':
        this.infoOpen.update((v) => !v);
        break;
      case 'f':
      case 'F':
        this.toggleFullscreen();
        break;
      case 'p':
      case 'P':
        if (this.current()?.file.type === 'image') this.toggleFaces();
        break;
      case 'r':
      case 'R':
        if (this.current()?.canRotate) void this.rotate();
        break;
      case '+':
      case '=':
        stage?.zoomIn();
        break;
      case '-':
      case '_':
        stage?.zoomOut();
        break;
      case '0':
        stage?.resetZoom();
        break;
      default:
        handled = false;
    }
    if (handled) event.preventDefault();
  }

  private readInfoOpenFromStorage(): boolean {
    try {
      return localStorage.getItem(INFO_OPEN_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }

  // The dialog renders in a .cdk-overlay-pane, so onKeydown leaves the arrow
  // and Escape keys to it while it is open.
  protected openHideFromDialog() {
    const data = this.current();
    if (!data || !this.isAdmin()) return;
    const target: HideFromTarget = {
      kind: 'file',
      fileId: data.file.id,
      fileType: data.file.type === 'video' ? 'video' : 'image',
    };
    this.dialog.open(HideFromDialog, { context: { target } });
  }

  protected openShareDialog() {
    const data = this.current();
    if (!data?.canManageShares) return;
    this.dialog.open(ShareItem, {
      context: { sourceType: 'file', sourceId: data.file.id, title: data.file.name },
    });
  }
}
