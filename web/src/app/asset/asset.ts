import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ErrorAlert } from '@core/components/error/error';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { environment } from '@env/environment';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronLeft, lucideChevronRight, lucideInfo, lucideX } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { injectQuery } from '@tanstack/angular-query-experimental';

@Component({
  selector: 'app-asset',
  imports: [ErrorAlert, RouterLink, NgIcon, HlmButton, HlmIcon, DatePipe, DecimalPipe],
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
        class="mx-auto flex h-12 w-full max-w-screen-xl items-center {{
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
        class="mx-auto flex h-[calc(100%-3rem)] w-full max-w-screen-xl items-stretch px-4"
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
              [src]="apiUrl + '/asset/' + f.id"
              class="mx-auto block h-full max-h-full w-full max-w-full rounded-lg object-contain"
              controls
              playsInline
            ></video>
          }

          @if (data.prevId) {
            <a
              [routerLink]="'/asset/' + data.prevId"
              [queryParams]="albumId ? { album: albumId } : null"
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
              [queryParams]="albumId ? { album: albumId } : null"
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
            class="h-full overflow-y-auto p-4 transition-opacity duration-150"
            [class.opacity-0]="!infoOpen()"
            [class.opacity-100]="infoOpen()"
          >
            <div class="mb-4 flex items-center justify-between">
              <h3 class="text-lg font-semibold">Details</h3>
            </div>

            <div class="space-y-1 text-sm">
              <div class="grid grid-cols-2 gap-1">
                <span class="text-muted-foreground">Type</span>
                <span>{{ f.type }}</span>

                <span class="text-muted-foreground">MIME</span>
                <span>{{ f.mime }}</span>

                <span class="text-muted-foreground">File name</span>
                <span class="truncate">{{ f.name }}</span>

                <span class="text-muted-foreground">Size</span>
                <span>{{ f.size | number }} bytes</span>

                <span class="text-muted-foreground">Path</span>
                <span class="truncate">{{ f.dir }}/{{ f.name }}</span>

                <span class="text-muted-foreground">Created</span>
                <span>{{ f.createdAt | date: 'medium' }}</span>
              </div>

              @if (data.imageMetadata) {
                <div class="mt-4 grid grid-cols-2 gap-2">
                  <span class="text-muted-foreground">Dimensions</span>
                  <span>{{ data.imageMetadata.width }} × {{ data.imageMetadata.height }}</span>

                  <span class="text-muted-foreground">Taken</span>
                  <span>{{
                    data.imageMetadata.takenAt ? (data.imageMetadata.takenAt | date: 'medium') : '—'
                  }}</span>
                </div>
              }

              @if (data.geoLocation) {
                <div class="mt-4 grid grid-cols-2 gap-2">
                  <span class="text-muted-foreground">Latitude</span>
                  <span>{{ data.geoLocation.lat }}</span>
                  <span class="text-muted-foreground">Longitude</span>
                  <span>{{ data.geoLocation.lon }}</span>
                </div>
              }
            </div>
          </div>
        </aside>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Asset {
  readonly apiUrl = environment.api.url;

  protected readonly trpc = injectTrpc();
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly backLink = this.route.snapshot.queryParamMap.get('from');
  protected readonly albumId = this.route.snapshot.queryParamMap.get('albumId');

  protected readonly infoOpen = signal(false);

  id = input.required<string>();

  file = injectQuery(() => ({
    queryKey: [CacheKey.AssetSingle, this.id(), this.albumId],
    staleTime: Infinity,
    networkMode: 'offlineFirst',
    queryFn: async () =>
      this.trpc.files.viewFile.query({ fileId: this.id(), albumId: this.albumId ?? undefined }),
  }));

  onKeydown(event: KeyboardEvent) {
    if (!this.file.isSuccess()) return;
    const data = this.file.data();
    if (!data) return;
    if (event.key === 'ArrowLeft' && data.prevId) {
      this.router.navigate(['/asset', data.prevId], {
        queryParams: this.albumId ? { album: this.albumId } : undefined,
      });
    } else if (event.key === 'ArrowRight' && data.nextId) {
      this.router.navigate(['/asset', data.nextId], {
        queryParams: this.albumId ? { album: this.albumId } : undefined,
      });
    }
  }
}
