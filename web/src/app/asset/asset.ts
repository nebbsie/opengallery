import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  OnDestroy,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ErrorAlert } from '@core/components/error/error';
import { CacheKey } from '@core/services/cache-key.types';
import { Sidebar } from '@core/services/sidebar/sidebar';
import { injectTrpc } from '@core/services/trpc';
import { UiSettingsService } from '@core/services/ui-settings/ui-settings';
import { environment } from '@env/environment';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronLeft, lucideChevronRight, lucideInfo, lucideX } from '@ng-icons/lucide';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { injectQuery } from '@tanstack/angular-query-experimental';

const INFO_OPEN_STORAGE_KEY = 'asset.infoOpen';

@Component({
  selector: 'app-asset',
  imports: [ErrorAlert, RouterLink, NgIcon, HlmButton, HlmIcon, HlmBadge, DatePipe],
  providers: [provideIcons({ lucideChevronLeft, lucideChevronRight, lucideInfo, lucideX })],
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
        class="mx-auto flex h-12 w-full items-center {{
          backLink ? ' justify-between' : 'justify-end'
        }}"
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
      <div
        class="mx-auto flex h-[calc(100%-3rem)] w-full items-stretch px-4"
        [class.gap-4]="infoOpen()"
        [class.gap-0]="!infoOpen()"
      >
        <!-- Media area -->
        <div class="relative flex h-full flex-1 items-center justify-center overflow-hidden">
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

        <!-- Slide-out info panel in-flow to shrink media area -->
        <aside
          class="bg-background text-foreground border-border absolute inset-0 right-0 z-50 translate-x-full transition-transform duration-150 ease-in-out sm:static sm:inset-auto sm:z-auto sm:shrink-0 sm:translate-x-0 sm:overflow-hidden sm:transition-[width] sm:duration-150 sm:ease-in-out"
          [class.translate-x-0]="infoOpen()"
          [class.pointer-events-none]="!infoOpen()"
          [class.w-70]="infoOpen()"
          [class.w-0]="!infoOpen()"
          [class.border-l]="infoOpen()"
        >
          <div
            class="h-full overflow-y-auto p-4 pr-0 transition-opacity duration-150"
            [class.opacity-0]="!infoOpen()"
            [class.opacity-100]="infoOpen()"
          >
            <div class="mb-4 flex items-center justify-between">
              <h3 class="text-lg font-semibold">Details</h3>
            </div>

            <div class="space-y-3 text-sm">
              <div>
                <div class="text-muted-foreground font-semibold">Name</div>
                <div class="truncate">{{ f.name }}</div>
              </div>

              <div>
                <div class="text-muted-foreground font-semibold">Size</div>
                <div>{{ formatBytes(f.size) }}</div>
              </div>

              @if (data.imageMetadata) {
                <div>
                  <div class="text-muted-foreground font-semibold">Dimensions</div>
                  <div class="flex flex-wrap items-center gap-2">
                    <span>{{ data.imageMetadata.width }} × {{ data.imageMetadata.height }}</span>
                    @if (f.type === 'video') {
                      <span hlmBadge [class]="getBadgeClass(data.imageMetadata.height)">{{
                        getVideoBadgeLabel(data.imageMetadata.height)
                      }}</span>
                    }
                  </div>
                </div>

                @if (shouldShowTaken(data.imageMetadata.takenAt, f.createdAt)) {
                  <div>
                    <div class="text-muted-foreground font-semibold">Taken</div>
                    <div>{{ data.imageMetadata.takenAt | date: 'M/d/y h:mma' }}</div>
                  </div>
                }
              }

              <div>
                <div class="text-muted-foreground font-semibold">Path</div>
                <div class="truncate" [title]="f.dir + '/' + f.name">{{ f.dir }}/{{ f.name }}</div>
              </div>

              <div>
                <div class="text-muted-foreground font-semibold">Imported</div>
                <div>{{ f.createdAt | date: 'M/d/y h:mma' }}</div>
              </div>
            </div>
          </div>
        </aside>
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

  protected readonly backLink = this.route.snapshot.queryParamMap.get('from');
  protected readonly albumId = this.route.snapshot.queryParamMap.get('albumId');

  protected readonly infoOpen = signal(this.readInfoOpenFromStorage());

  private wasSideBarOpen: boolean;

  constructor() {
    this.wasSideBarOpen = this.sidebar.isOpen();
    // Defer auto-close behavior to UI setting loaded via service
    effect(() => {
      const autoClose = this.uiSettings.autoCloseSidebarOnAssetOpen();
      if (autoClose === null) return; // not yet loaded
      if (autoClose && this.wasSideBarOpen && this.sidebar.isOpen()) {
        this.sidebar.close();
      }
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
    queryKey: [CacheKey.AssetSingle, this.id(), this.albumId],
    staleTime: Infinity,
    networkMode: 'offlineFirst',
    queryFn: async () =>
      this.trpc.files.viewFile.query({ fileId: this.id(), albumId: this.albumId ?? undefined }),
  }));

  // No direct query here; we rely on UiSettingsService

  protected getNavQueryParams(): Record<string, string> | null {
    const qp: Record<string, string> = {};
    if (this.albumId) qp['album'] = this.albumId;
    if (this.backLink) qp['from'] = this.backLink;
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
        return 'bg-secondary text-secondary-foreground';
      case 'HD':
        return 'bg-blue-600 text-white';
      case 'FHD':
        return 'bg-indigo-600 text-white';
      case 'QHD':
        return 'bg-purple-600 text-white';
      case '4K':
        return 'bg-emerald-600 text-white';
      case '8K':
        return 'bg-rose-600 text-white';
      default:
        return 'bg-primary text-primary-foreground';
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

  onKeydown(event: KeyboardEvent) {
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
    if (this.wasSideBarOpen) {
      this.sidebar.open();
    }
  }
}
