import { DatePipe, NgClass } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  inject,
  input,
  OnDestroy,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ErrorAlert } from '@core/components/error/error';
import { ShareItem } from '@core/dialogs/share-item/share-item';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { environment } from '@env/environment';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideChevronLeft,
  lucideChevronRight,
  lucideCopy,
  lucideDownload,
  lucideFolder,
  lucideInfo,
  lucideShare2,
  lucideUser,
  lucideX,
} from '@ng-icons/lucide';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import * as L from 'leaflet';

const INFO_OPEN_STORAGE_KEY = 'asset.infoOpen';

@Component({
  selector: 'app-asset',
  imports: [ErrorAlert, RouterLink, NgIcon, HlmButton, HlmIcon, HlmBadge, DatePipe, NgClass],
  providers: [
    provideIcons({
      lucideChevronLeft,
      lucideChevronRight,
      lucideCopy,
      lucideDownload,
      lucideFolder,
      lucideInfo,
      lucideShare2,
      lucideUser,
      lucideX,
    }),
  ],
  host: {
    class: 'relative block h-full w-full overflow-hidden',
    '(document:keydown)': 'onKeydown($event)',
  },
  template: `
    @if (file.isError()) {
      <app-error-alert [error]="file.error()" />
    }

    @if (file.isSuccess() && file.data(); as data) {
      <!-- Scrim so the controls stay legible over bright photos -->
      <div
        class="pointer-events-none absolute inset-x-0 top-0 z-40 h-20 bg-gradient-to-b from-black/40 to-transparent"
        aria-hidden="true"
      ></div>

      <div
        class="absolute z-50 flex w-full items-center p-2 {{
          backLink ? 'justify-between' : 'justify-end'
        }}"
      >
        @if (backLink) {
          <a hlmBtn variant="ghost" size="icon" class="{{ ctrlBtn }}" [routerLink]="backLink">
            <ng-icon hlm name="lucideX" />
          </a>
        }

        <div class="flex items-center gap-1.5">
          <a
            hlmBtn
            variant="ghost"
            size="icon"
            class="{{ ctrlBtn }}"
            [href]="apiUrl + '/asset/' + data.file.id"
            [download]="data.file.name"
            title="Download original"
          >
            <ng-icon hlm name="lucideDownload" />
          </a>

          @if (data.canManageShares) {
            <button
              hlmBtn
              variant="ghost"
              size="icon"
              class="{{ ctrlBtn }}"
              type="button"
              title="Share"
              (click)="openShareDialog()"
            >
              <ng-icon hlm name="lucideShare2" />
            </button>
          }

          <button
            hlmBtn
            variant="ghost"
            size="icon"
            class="{{ ctrlBtn }}"
            title="Info"
            (click)="infoOpen.set(!infoOpen())"
          >
            <ng-icon hlm name="lucideInfo" />
          </button>
        </div>
      </div>

      @let f = data.file;
      <div class="mx-auto h-full w-full">
        <div class="flex h-full flex-col sm:flex-row sm:items-stretch">
          <!-- Media area. Touch handlers drive swipe navigation on mobile:
               drag horizontally and release past a threshold to move to the
               prev/next asset; short drags snap back. -->
          <div
            class="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
            (touchstart)="onTouchStart($event)"
            (touchmove)="onTouchMove($event)"
            (touchend)="onTouchEnd()"
            (touchcancel)="onTouchEnd()"
          >
            <div
              class="flex h-full w-full items-center justify-center"
              [style.transform]="dragX() ? 'translateX(' + dragX() + 'px)' : null"
              [style.transition]="dragging() ? 'none' : 'transform 150ms ease-out'"
            >
              @if (f.type === 'image') {
                <img
                  [src]="apiUrl + '/asset/' + f.id + '/optimised'"
                  alt="Image"
                  draggable="false"
                  class="mx-auto block h-full max-h-full w-full max-w-full rounded-lg object-contain"
                />
              } @else if (f.type === 'video') {
                <video
                  [src]="apiUrl + '/asset/' + f.id + '/optimised'"
                  [poster]="apiUrl + '/asset/' + f.id + '/thumbnail'"
                  class="mx-auto block h-full max-h-full w-full max-w-full rounded-lg object-contain"
                  controls
                  playsInline
                  autoplay
                ></video>
              }
            </div>

            @if (data.prevId) {
              <a
                [routerLink]="'/asset/' + data.prevId"
                [queryParams]="getNavQueryParams()"
                class="absolute top-1/2 left-3 -translate-y-1/2 {{ ctrlBtn }}"
                hlmBtn
                variant="ghost"
                size="icon"
              >
                <ng-icon hlm name="lucideChevronLeft" />
              </a>
            }
            @if (data.nextId) {
              <a
                [routerLink]="'/asset/' + data.nextId"
                [queryParams]="getNavQueryParams()"
                class="absolute top-1/2 right-3 -translate-y-1/2 {{ ctrlBtn }}"
                hlmBtn
                variant="ghost"
                size="icon"
              >
                <ng-icon hlm name="lucideChevronRight" />
              </a>
            }
          </div>

          <!-- Info panel -->
          <aside
            class="bg-background w-full overflow-hidden transition-[height,width] duration-150 ease-in-out sm:flex-shrink-0"
            [ngClass]="
              infoOpen()
                ? 'h-[50vh] border-t border-border sm:h-full sm:w-80 sm:border-t-0 sm:border-l'
                : 'h-0 sm:w-0'
            "
          >
            <div
              class="h-full overflow-y-auto p-4 transition-opacity duration-150"
              [class.opacity-0]="!infoOpen()"
              [class.opacity-100]="infoOpen()"
            >
              <div class="space-y-6">
                <!-- File Information Section -->
                <section>
                  <h4 class="text-foreground mb-3 text-xs font-semibold tracking-wider uppercase">
                    File Info
                  </h4>
                  <div class="space-y-3">
                    <div class="flex items-start justify-between gap-3">
                      <span class="text-muted-foreground text-xs">Name</span>
                      <span class="text-right text-sm font-medium break-words">{{ f.name }}</span>
                    </div>
                    <div class="flex items-center justify-between gap-3">
                      <span class="text-muted-foreground text-xs">Size</span>
                      <span class="text-sm">{{ formatBytes(f.size) }}</span>
                    </div>
                    @if (data.imageMetadata) {
                      <div class="flex items-center justify-between gap-3">
                        <span class="text-muted-foreground text-xs">Dimensions</span>
                        <div class="flex items-center gap-2">
                          <span class="text-sm font-medium"
                            >{{ data.imageMetadata.width }} × {{ data.imageMetadata.height }}</span
                          >
                          @if (f.type === 'image') {
                            <span hlmBadge class="bg-primary text-primary-foreground font-bold">{{
                              getMegapixels(data.imageMetadata.width, data.imageMetadata.height)
                            }}</span>
                          }
                          @if (f.type === 'video') {
                            <span hlmBadge [class]="getBadgeClass(data.imageMetadata.height)">{{
                              getVideoBadgeLabel(data.imageMetadata.height)
                            }}</span>
                          }
                        </div>
                      </div>
                    }
                  </div>
                </section>

                @if (data.people && data.people.length) {
                  <div class="border-border border-t pt-6">
                    <section>
                      <h4
                        class="text-foreground mb-3 text-xs font-semibold tracking-wider uppercase"
                      >
                        People
                      </h4>
                      <div class="flex flex-wrap gap-3">
                        @for (person of data.people; track person.personId) {
                          <a
                            [routerLink]="['/faces', person.personId]"
                            class="group flex w-16 flex-col items-center gap-1.5"
                            [title]="person.name || 'Unnamed person'"
                          >
                            <div
                              class="bg-muted ring-border group-hover:ring-primary h-14 w-14 overflow-hidden rounded-full ring-1 transition"
                            >
                              @if (person.hasCrop) {
                                <img
                                  [src]="apiUrl + '/face/' + person.faceId"
                                  [alt]="person.name || 'Unnamed person'"
                                  class="h-full w-full object-cover transition-transform group-hover:scale-105"
                                  loading="lazy"
                                />
                              } @else {
                                <div
                                  class="text-muted-foreground grid h-full w-full place-items-center"
                                >
                                  <ng-icon hlm name="lucideUser" />
                                </div>
                              }
                            </div>
                            <span
                              class="text-muted-foreground group-hover:text-foreground w-full truncate text-center text-xs transition-colors"
                            >
                              {{ person.name || 'Unnamed' }}
                            </span>
                          </a>
                        }
                      </div>
                    </section>
                  </div>
                }

                @if (data.albums && data.albums.length) {
                  <div class="border-border border-t pt-6">
                    <section>
                      <h4
                        class="text-foreground mb-3 text-xs font-semibold tracking-wider uppercase"
                      >
                        Albums
                      </h4>
                      <div class="space-y-1.5">
                        @for (album of data.albums; track album.id) {
                          <a
                            [routerLink]="['/albums', album.id]"
                            class="text-foreground hover:bg-secondary/50 group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors"
                            [title]="album.name"
                          >
                            <ng-icon
                              hlm
                              name="lucideFolder"
                              class="text-muted-foreground group-hover:text-foreground shrink-0 transition-colors"
                            />
                            <span class="truncate">{{ album.name }}</span>
                          </a>
                        }
                      </div>
                    </section>
                  </div>
                }

                @if (
                  data.imageMetadata &&
                  (shouldShowTaken(data.imageMetadata.takenAt, f.createdAt) ||
                    data.imageMetadata.cameraMake ||
                    data.imageMetadata.cameraModel ||
                    data.imageMetadata.lensModel ||
                    data.imageMetadata.iso !== null ||
                    data.imageMetadata.exposureTime ||
                    data.imageMetadata.fNumber ||
                    data.imageMetadata.focalLength !== null)
                ) {
                  <div class="border-border border-t pt-6">
                    <section>
                      <h4
                        class="text-foreground mb-3 text-xs font-semibold tracking-wider uppercase"
                      >
                        Capture Details
                      </h4>
                      <div class="space-y-3">
                        @if (shouldShowTaken(data.imageMetadata.takenAt, f.createdAt)) {
                          <div class="flex items-center justify-between gap-3">
                            <span class="text-muted-foreground text-xs">Taken</span>
                            <span class="text-sm">{{
                              data.imageMetadata.takenAt | date: 'MMM d, y · h:mma'
                            }}</span>
                          </div>
                        }

                        @if (data.imageMetadata.cameraMake || data.imageMetadata.cameraModel) {
                          <div class="flex items-start justify-between gap-3">
                            <span class="text-muted-foreground text-xs">Camera</span>
                            <span class="text-right text-sm font-medium break-words">
                              {{ data.imageMetadata.cameraMake || '' }}
                              {{ data.imageMetadata.cameraModel || '' }}
                            </span>
                          </div>
                        }

                        @if (data.imageMetadata.lensModel) {
                          <div class="flex items-start justify-between gap-3">
                            <span class="text-muted-foreground text-xs">Lens</span>
                            <span class="text-right text-sm break-words">{{
                              data.imageMetadata.lensModel
                            }}</span>
                          </div>
                        }

                        @if (
                          data.imageMetadata.exposureTime ||
                          data.imageMetadata.fNumber ||
                          data.imageMetadata.iso !== null ||
                          data.imageMetadata.focalLength !== null
                        ) {
                          <div class="flex items-start justify-between gap-3">
                            <span class="text-muted-foreground text-xs">Settings</span>
                            <div class="flex flex-wrap justify-end gap-1.5">
                              @if (data.imageMetadata.exposureTime) {
                                <span
                                  class="bg-secondary text-secondary-foreground rounded px-2 py-0.5 text-xs font-medium"
                                  >{{ formatShutterSpeed(data.imageMetadata.exposureTime) }}</span
                                >
                              }
                              @if (data.imageMetadata.fNumber) {
                                <span
                                  class="bg-secondary text-secondary-foreground rounded px-2 py-0.5 text-xs font-medium"
                                  >f/{{ data.imageMetadata.fNumber }}</span
                                >
                              }
                              @if (data.imageMetadata.iso !== null) {
                                <span
                                  class="bg-secondary text-secondary-foreground rounded px-2 py-0.5 text-xs font-medium"
                                  >ISO {{ data.imageMetadata.iso }}</span
                                >
                              }
                              @if (data.imageMetadata.focalLength !== null) {
                                <span
                                  class="bg-secondary text-secondary-foreground rounded px-2 py-0.5 text-xs font-medium"
                                  >{{ data.imageMetadata.focalLength }}mm</span
                                >
                              }
                            </div>
                          </div>
                        }
                      </div>
                    </section>
                  </div>
                }

                @if (data.geoLocation) {
                  <div class="border-border border-t pt-6">
                    <section>
                      <h4
                        class="text-foreground mb-3 text-xs font-semibold tracking-wider uppercase"
                      >
                        Location
                      </h4>
                      <div
                        #mapContainer
                        class="border-border h-48 w-full overflow-hidden rounded-lg border shadow-sm"
                      ></div>
                    </section>
                  </div>
                }

                <!-- Import Details Section -->
                <div class="border-border border-t pt-6">
                  <section>
                    <h4 class="text-foreground mb-3 text-xs font-semibold tracking-wider uppercase">
                      Import Details
                    </h4>
                    <div class="space-y-3">
                      <div class="flex items-start justify-between gap-3">
                        <span class="text-muted-foreground text-xs">Filename</span>
                        <span class="text-right text-sm font-medium break-words">{{ f.name }}</span>
                      </div>
                      <div class="flex items-center justify-between gap-3">
                        <span class="text-muted-foreground text-xs">Imported</span>
                        <span class="text-sm">{{ f.createdAt | date: 'MMM d, y · h:mma' }}</span>
                      </div>
                    </div>
                  </section>
                </div>

                <!-- On Disk Section -->
                <div class="border-border border-t pt-6">
                  <section>
                    <h4 class="text-foreground mb-3 text-xs font-semibold tracking-wider uppercase">
                      On Disk
                    </h4>
                    <div
                      class="bg-secondary/30 text-muted-foreground hover:bg-secondary/50 group relative rounded-md border p-3 font-mono text-[11px] break-all transition-colors"
                    >
                      {{ f.dir }}/{{ f.name }}
                      <button
                        hlmBtn
                        variant="ghost"
                        size="icon"
                        class="absolute top-1 right-1 h-6 w-6 opacity-0 transition-[opacity,scale] group-hover:opacity-100 active:scale-[0.96]"
                        (click)="copyToClipboard(f.dir + '/' + f.name)"
                        title="Copy path"
                      >
                        <ng-icon hlm name="lucideCopy" size="sm" />
                      </button>
                    </div>
                  </section>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Asset implements OnDestroy {
  readonly apiUrl = environment.api.url;

  // Shared style for media-overlay controls: a translucent dark pill with a
  // white icon so they stay legible over any photo, in light or dark theme.
  protected readonly ctrlBtn =
    'border-0 bg-black/35 text-white backdrop-blur-sm transition-transform hover:bg-black/55 hover:text-white active:scale-[0.96]';

  protected readonly trpc = injectTrpc();
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly queryClient = inject(QueryClient);
  private readonly dialog = inject(HlmDialogService);

  protected readonly backLink = this.route.snapshot.queryParamMap.get('from');
  protected readonly albumId = this.route.snapshot.queryParamMap.get('albumId');
  protected readonly cameraMake = this.route.snapshot.queryParamMap.get('cameraMake');
  protected readonly cameraModel = this.route.snapshot.queryParamMap.get('cameraModel');
  protected readonly kind = this.route.snapshot.queryParamMap.get('kind') as 'image' | 'video' | 'all' | null;
  protected readonly personId = this.route.snapshot.queryParamMap.get('personId');

  protected readonly infoOpen = signal(this.readInfoOpenFromStorage());

  // Swipe-to-navigate (mobile). `dragX` is the live horizontal offset of the
  // media while a finger is down; `dragging` disables the snap-back transition
  // during the drag so the media tracks the finger 1:1.
  protected readonly dragX = signal(0);
  protected readonly dragging = signal(false);
  private touchStartX = 0;
  private touchStartY = 0;
  private touchActive = false;
  // Locks the gesture to one axis after the first few px so a vertical scroll
  // intent doesn't get hijacked as a horizontal swipe.
  private axisLock: 'h' | 'v' | null = null;
  private static readonly SWIPE_THRESHOLD = 60;

  private map: L.Map | null = null;
  protected readonly mapContainer = viewChild<ElementRef<HTMLDivElement>>('mapContainer');

  constructor() {
    // Initialize map when data and container are available
    effect(() => {
      const data = this.file.data();
      const container = this.mapContainer();

      // Clean up existing map first
      if (this.map) {
        this.map.remove();
        this.map = null;
      }

      // Create new map if we have geolocation data
      if (data?.geoLocation && container) {
        this.initMap(Number(data.geoLocation.lat), Number(data.geoLocation.lon));
      }
    });

    // Prefetch next/prev asset data and preload media to reduce flicker
    effect(() => {
      const data = this.file.data();
      if (!data) return;

      const albumId = this.albumId ?? undefined;
      const cameraMake = this.cameraMake ?? undefined;
      const cameraModel = this.cameraModel ?? undefined;
      const kind = this.kind ?? undefined;
      const personId = this.personId ?? undefined;

      const prefetch = async (id: string | null) => {
        if (!id) return;
        const key = [CacheKey.AssetSingle, id, this.albumId, this.cameraMake, this.cameraModel, this.kind, this.personId];
        await this.queryClient.prefetchQuery({
          queryKey: key,
          queryFn: () =>
            this.trpc.files.viewFile.query({ fileId: id, albumId, cameraMake, cameraModel, kind, personId }),
          staleTime: 60_000,
        });

        // After metadata is cached, decide what to preload
        const cached = this.queryClient.getQueryData(key as unknown as readonly unknown[]) as
          | { file?: { type?: 'image' | 'video' } }
          | undefined;
        const fileType = cached?.file?.type;
        if (fileType === 'image') {
          this.preloadUrl(`${this.apiUrl}/asset/${id}/optimised`);
        } else {
          // Always safe to preload thumbnail (image) for both images/videos
          this.preloadUrl(`${this.apiUrl}/asset/${id}/thumbnail`);
        }
      };

      void prefetch(data.nextId);
      void prefetch(data.prevId);
    });
  }

  // Persist info panel state in localStorage (browser only)
  private readonly persistInfoOpen = effect(() => {
    const isBrowser = typeof window !== 'undefined' && typeof localStorage !== 'undefined';
    if (!isBrowser) return undefined;
    const value = this.infoOpen();
    try {
      localStorage.setItem(INFO_OPEN_STORAGE_KEY, value ? '1' : '0');
    } catch {
      // no-op
    }
    return undefined;
  });

  id = input.required<string>();

  file = injectQuery(() => ({
    queryKey: [CacheKey.AssetSingle, this.id(), this.albumId, this.cameraMake, this.cameraModel, this.kind, this.personId],
    staleTime: Infinity,
    networkMode: 'offlineFirst',
    queryFn: async () =>
      this.trpc.files.viewFile.query({
        fileId: this.id(),
        albumId: this.albumId ?? undefined,
        cameraMake: this.cameraMake ?? undefined,
        cameraModel: this.cameraModel ?? undefined,
        kind: this.kind ?? undefined,
        personId: this.personId ?? undefined,
      }),
  }));

  // No direct query here; we rely on UiSettingsService

  protected getNavQueryParams(): Record<string, string> | null {
    const qp: Record<string, string> = {};
    if (this.albumId) qp['albumId'] = this.albumId;
    if (this.backLink) qp['from'] = this.backLink;
    if (this.cameraMake) qp['cameraMake'] = this.cameraMake;
    if (this.cameraModel) qp['cameraModel'] = this.cameraModel;
    if (this.kind) qp['kind'] = this.kind;
    if (this.personId) qp['personId'] = this.personId;
    return Object.keys(qp).length ? qp : null;
  }

  protected getVideoResolutionLabel(height: number | null | undefined): string {
    if (!height) return '';
    if (height < 540) return '480p';
    if (height < 800) return '720p';
    if (height < 1300) return '1080p';
    if (height < 1900) return '1440p';
    if (height < 2600) return '2160p';
    if (height < 4400) return '4320p';
    if (height < 9000) return '8640p';
    return `${height}p`;
  }

  protected getVideoTierLabel(height: number | null | undefined): string {
    if (!height) return '';
    if (height < 720) return 'SD';
    if (height < 1080) return 'HD';
    if (height < 1440) return 'FHD';
    if (height < 2160) return 'QHD';
    if (height < 4320) return '4K';
    if (height < 8640) return '8K';
    return 'Ultra';
  }

  protected getVideoBadgeLabel(height: number | null | undefined): string {
    const res = this.getVideoResolutionLabel(height);
    const tier = this.getVideoTierLabel(height);
    if (!res && !tier) return '';
    if (!res) return tier;
    if (!tier) return res;
    return `${res} · ${tier}`;
  }

  protected getBadgeClass(height: number | null | undefined): string {
    const tier = this.getVideoTierLabel(height);
    switch (tier) {
      case 'SD':
        return 'bg-secondary text-secondary-foreground font-bold';
      case 'HD':
        return 'bg-blue-600 text-white font-bold';
      case 'FHD':
        return 'bg-indigo-600 text-white font-bold';
      case 'QHD':
        return 'bg-purple-600 text-white font-bold';
      case '4K':
        return 'bg-emerald-600 text-white font-bold';
      case '8K':
        return 'bg-rose-600 text-white font-bold';
      default:
        return 'bg-primary text-primary-foreground font-bold';
    }
  }

  protected formatBytes(bytes: number | null | undefined): string {
    const size = typeof bytes === 'number' && isFinite(bytes) && bytes >= 0 ? bytes : 0;
    if (size === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
    const value = size / Math.pow(1024, i);
    return `${value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[i]}`;
  }

  protected getMegapixels(
    width: number | null | undefined,
    height: number | null | undefined,
  ): string {
    if (!width || !height) return '';
    const megapixels = (width * height) / 1_000_000;
    if (megapixels < 1) {
      return `${(megapixels * 1000).toFixed(0)}K`;
    }
    return `${megapixels.toFixed(1)} MP`;
  }

  protected formatShutterSpeed(value: string | number): string {
    const n = typeof value === 'number' ? value : Number(value);
    if (!isFinite(n) || n <= 0) return String(value);
    if (n >= 1) {
      // 1s or longer; show with s suffix, trim trailing zeros
      const rounded = n >= 10 ? n.toFixed(0) : n >= 1 ? n.toFixed(1) : String(n);
      return `${Number(rounded)}s`;
    }
    // Shorter than 1s: render as a fraction 1/x, rounding denominator nicely
    const denom = Math.round(1 / n);
    return `1/${denom}`;
  }

  protected shouldShowTaken(
    takenAt: Date | string | null | undefined,
    createdAt: Date | string | null | undefined,
  ): boolean {
    if (!takenAt) return false;
    try {
      const t = new Date(takenAt as unknown as string).getTime();
      const c = createdAt ? new Date(createdAt as unknown as string).getTime() : NaN;
      if (Number.isNaN(t) || Number.isNaN(c)) return true;
      // Compare by day to avoid tiny differences; treat same-day as equal
      const sameDay = new Date(t).toDateString() === new Date(c).toDateString();
      return !sameDay;
    } catch {
      return true;
    }
  }

  private readInfoOpenFromStorage(): boolean {
    const isBrowser = typeof window !== 'undefined' && typeof localStorage !== 'undefined';
    if (!isBrowser) return false;
    try {
      const raw = localStorage.getItem(INFO_OPEN_STORAGE_KEY);
      return raw === '1';
    } catch {
      return false;
    }
  }

  protected async copyToClipboard(value: string) {
    if (!value) return;
    const hasNavigator = typeof navigator !== 'undefined';
    const hasDocument = typeof document !== 'undefined';
    try {
      if (hasNavigator && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return;
      }
      if (!hasDocument) return;
      const el = document.createElement('textarea');
      el.value = value;
      el.setAttribute('readonly', '');
      el.style.position = 'fixed';
      el.style.top = '-9999px';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    } catch {
      // no-op
    }
  }

  onKeydown(event: KeyboardEvent) {
    // Allow quick back navigation with ESC when coming from a page
    if (this.backLink && event.key === 'Escape') {
      this.router.navigateByUrl(this.backLink);
      return;
    }
    if (!this.file.isSuccess()) return;
    const data = this.file.data();
    if (!data) return;
    if (event.key === 'ArrowLeft' && data.prevId) {
      this.navigateToAsset(data.prevId);
    } else if (event.key === 'ArrowRight' && data.nextId) {
      this.navigateToAsset(data.nextId);
    }
  }

  private navigateToAsset(id: string) {
    this.router.navigate(['/asset', id], {
      queryParams: this.getNavQueryParams() || undefined,
    });
  }

  onTouchStart(event: TouchEvent) {
    // Ignore multi-touch (pinch-zoom) — only single-finger drags swipe.
    if (event.touches.length !== 1) {
      this.touchActive = false;
      return;
    }
    const t = event.touches[0];
    this.touchStartX = t.clientX;
    this.touchStartY = t.clientY;
    this.touchActive = true;
    this.axisLock = null;
    this.dragging.set(true);
  }

  onTouchMove(event: TouchEvent) {
    if (!this.touchActive || event.touches.length !== 1) return;
    const t = event.touches[0];
    const dx = t.clientX - this.touchStartX;
    const dy = t.clientY - this.touchStartY;

    // Wait for a clear intent, then lock to the dominant axis. A vertical lock
    // bows out so the page can scroll normally.
    if (this.axisLock === null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      this.axisLock = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
      if (this.axisLock === 'v') {
        this.touchActive = false;
        this.dragging.set(false);
        return;
      }
    }

    // Add rubber-band resistance at the ends where there's nowhere to go.
    const data = this.file.data();
    const atEnd = (dx > 0 && !data?.prevId) || (dx < 0 && !data?.nextId);
    this.dragX.set(atEnd ? dx * 0.3 : dx);
    // We've committed to a horizontal swipe; stop the browser treating it as a
    // scroll or back-gesture.
    event.preventDefault();
  }

  onTouchEnd() {
    if (!this.touchActive) {
      // Vertical/multi-touch gesture or no drag — make sure we're reset.
      this.dragging.set(false);
      this.dragX.set(0);
      return;
    }
    this.touchActive = false;

    const dx = this.dragX();
    const data = this.file.data();
    if (dx <= -Asset.SWIPE_THRESHOLD && data?.nextId) {
      this.commitSwipe(data.nextId);
    } else if (dx >= Asset.SWIPE_THRESHOLD && data?.prevId) {
      this.commitSwipe(data.prevId);
    } else {
      // Not far enough — animate back to centre.
      this.dragging.set(false);
      this.dragX.set(0);
    }
  }

  // Snap the offset away without an animation, then route to the target. The
  // component instance is reused across asset routes, so resetting here keeps
  // the incoming media centred rather than sliding in from the old offset.
  private commitSwipe(id: string) {
    this.dragging.set(true);
    this.dragX.set(0);
    this.navigateToAsset(id);
  }

  ngOnDestroy(): void {
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  }

  private initMap(lat: number, lon: number): void {
    const container = this.mapContainer()?.nativeElement;
    if (!container || this.map) return;

    // Fix Leaflet's default icon path issue in bundled apps
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (L.Icon.Default.prototype as any)._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    });

    this.map = L.map(container, {
      center: [lat, lon],
      zoom: 13,
      zoomControl: false,
      attributionControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    }).addTo(this.map);

    L.marker([lat, lon]).addTo(this.map);
  }

  private readonly preloaded = new Set<string>();
  private preloadUrl(url: string) {
    if (typeof window === 'undefined') return;
    if (this.preloaded.has(url)) return;
    this.preloaded.add(url);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.loading = 'eager';
      img.src = url;
    } catch {
      // ignore
    }
  }

  openShareDialog() {
    const data = this.file.data();
    if (!data?.canManageShares) {
      return;
    }

    this.dialog.open(ShareItem, {
      context: {
        sourceType: 'file',
        sourceId: data.file.id,
        title: data.file.name,
      },
    });
  }
}
