import { DatePipe } from '@angular/common';
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
import { CacheKey } from '@core/services/cache-key.types';
import { ScreenSize } from '@core/services/screen-size/screen-size';
import { Sidebar } from '@core/services/sidebar/sidebar';
import { injectTrpc } from '@core/services/trpc';
import { UiSettingsService } from '@core/services/ui-settings/ui-settings';
import { environment } from '@env/environment';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideChevronLeft,
  lucideChevronRight,
  lucideCopy,
  lucideInfo,
  lucideX,
} from '@ng-icons/lucide';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import * as L from 'leaflet';

const INFO_OPEN_STORAGE_KEY = 'asset.infoOpen';

@Component({
  selector: 'app-asset',
  imports: [ErrorAlert, RouterLink, NgIcon, HlmButton, HlmIcon, HlmBadge, DatePipe],
  providers: [
    provideIcons({ lucideChevronLeft, lucideChevronRight, lucideCopy, lucideInfo, lucideX }),
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
      <div
        class="mx-auto flex w-full items-center {{ backLink ? ' justify-between' : 'justify-end' }}"
      >
        @if (backLink) {
          <a hlmBtn variant="ghost" size="icon" [routerLink]="backLink">
            <ng-icon hlm name="lucideChevronLeft" />
          </a>
        }

        <button hlmBtn variant="ghost" size="icon" (click)="infoOpen.set(!infoOpen())">
          <ng-icon hlm name="lucideInfo" />
        </button>
      </div>

      @let f = data.file;
      <div class="mx-auto h-[calc(100%-3rem)] w-full">
        <div class="flex h-full flex-col sm:flex-row sm:items-stretch">
          <!-- Media area -->
          <div class="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
            @if (f.type === 'image') {
              <img
                [src]="apiUrl + '/asset/' + f.id + '/optimised'"
                alt="Image"
                class="mx-auto block h-full max-h-full w-full max-w-full rounded-lg object-contain"
              />
            } @else if (f.type === 'video') {
              <video
                [src]="apiUrl + '/asset/' + f.id + '/optimised'"
                [poster]="apiUrl + '/asset/' + f.id + '/thumbnail'"
                class="mx-auto block h-full max-h-full w-full max-w-full rounded-lg object-contain"
                controls
                playsInline
              ></video>
            }

            @if (data.prevId) {
              <a
                [routerLink]="'/asset/' + data.prevId"
                [queryParams]="getNavQueryParams()"
                class="absolute top-1/2 left-2 -translate-y-1/2 bg-black/60"
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
                class="absolute top-1/2 right-2 -translate-y-1/2 bg-black/60"
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
            class="overflow-hidden transition-all duration-150 ease-in-out"
            [class.h-0]="!infoOpen()"
            [class.h-auto]="infoOpen()"
            [class.sm:w-0]="!infoOpen()"
            [class.sm:w-80]="infoOpen()"
            [class.sm:flex-shrink-0]="true"
            [class.w-full]="true"
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
                        class="absolute top-1 right-1 h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
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

  protected readonly trpc = injectTrpc();
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly sidebar = inject(Sidebar);
  private readonly uiSettings = inject(UiSettingsService);
  private readonly queryClient = inject(QueryClient);
  private readonly screenSize = inject(ScreenSize);

  protected readonly backLink = this.route.snapshot.queryParamMap.get('from');
  protected readonly albumId = this.route.snapshot.queryParamMap.get('albumId');
  protected readonly cameraMake = this.route.snapshot.queryParamMap.get('cameraMake');
  protected readonly cameraModel = this.route.snapshot.queryParamMap.get('cameraModel');

  protected readonly infoOpen = signal(false);

  private wasSideBarOpen: boolean;
  private hasAutoClosedSidebar = false;
  private map: L.Map | null = null;
  protected readonly mapContainer = viewChild<ElementRef<HTMLDivElement>>('mapContainer');

  constructor() {
    this.wasSideBarOpen = this.sidebar.isOpen();
    // Defer auto-close behavior to UI setting loaded via service
    effect(() => {
      const autoClose = this.uiSettings.autoCloseSidebarOnAssetOpen();
      if (autoClose === null) return; // not yet loaded
      if (autoClose && this.wasSideBarOpen && this.sidebar.isOpen() && !this.hasAutoClosedSidebar) {
        this.sidebar.close();
        this.hasAutoClosedSidebar = true;
      }
    });

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

      const prefetch = async (id: string | null) => {
        if (!id) return;
        const key = [CacheKey.AssetSingle, id, this.albumId, this.cameraMake, this.cameraModel];
        await this.queryClient.prefetchQuery({
          queryKey: key,
          queryFn: () =>
            this.trpc.files.viewFile.query({ fileId: id, albumId, cameraMake, cameraModel }),
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
    queryKey: [CacheKey.AssetSingle, this.id(), this.albumId, this.cameraMake, this.cameraModel],
    staleTime: Infinity,
    networkMode: 'offlineFirst',
    queryFn: async () =>
      this.trpc.files.viewFile.query({
        fileId: this.id(),
        albumId: this.albumId ?? undefined,
        cameraMake: this.cameraMake ?? undefined,
        cameraModel: this.cameraModel ?? undefined,
      }),
  }));

  // No direct query here; we rely on UiSettingsService

  protected getNavQueryParams(): Record<string, string> | null {
    const qp: Record<string, string> = {};
    if (this.albumId) qp['albumId'] = this.albumId;
    if (this.backLink) qp['from'] = this.backLink;
    if (this.cameraMake) qp['cameraMake'] = this.cameraMake;
    if (this.cameraModel) qp['cameraModel'] = this.cameraModel;
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
      this.router.navigate(['/asset', data.prevId], {
        queryParams: this.getNavQueryParams() || undefined,
      });
    } else if (event.key === 'ArrowRight' && data.nextId) {
      this.router.navigate(['/asset', data.nextId], {
        queryParams: this.getNavQueryParams() || undefined,
      });
    }
  }

  ngOnDestroy(): void {
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
    if (this.wasSideBarOpen) {
      this.sidebar.open();
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
}
