import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ErrorAlert } from '@core/components/error/error';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCamera } from '@ng-icons/lucide';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { injectQuery } from '@tanstack/angular-query-experimental';

@Component({
  selector: 'app-cameras-list',
  providers: [provideIcons({ lucideCamera })],
  imports: [ErrorAlert, NgIcon, HlmIcon, RouterLink],
  host: { class: 'block h-full overflow-y-auto' },
  template: `
    @if (cameras.isPending() && !cameras.data()) {
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        @for (i of skeletonTiles; track i) {
          <div class="bg-card flex items-center gap-3 rounded-xl border p-4 shadow-sm">
            <div class="bg-muted h-12 w-12 shrink-0 animate-pulse rounded-xl"></div>
            <div class="min-w-0 flex-1 space-y-2">
              <div class="bg-muted h-4 w-2/3 animate-pulse rounded"></div>
              <div class="bg-muted h-3 w-1/2 animate-pulse rounded"></div>
              <div class="bg-muted h-3 w-1/4 animate-pulse rounded"></div>
            </div>
          </div>
        }
      </div>
    } @else if (cameras.isError() && !cameras.data()) {
      <app-error-alert [error]="cameras.error()" />
    } @else {
      @if (cameras.data()!.length === 0) {
        <div class="text-muted-foreground flex flex-col items-center justify-center py-12">
          <ng-icon hlm size="xl" name="lucideCamera" class="mb-4" />
          <p>No cameras found</p>
          <p class="text-sm">Photos with camera metadata will appear here</p>
        </div>
      } @else {
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          @for (camera of cameras.data()!; track camera.make + camera.model) {
            <a
              [routerLink]="['/cameras', camera.make, camera.model]"
              class="bg-card hover:border-foreground/20 group rounded-xl border p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
            >
              <div class="flex items-center gap-3">
                <div class="bg-muted text-foreground group-hover:bg-foreground group-hover:text-background rounded-xl p-3 transition-colors">
                  <ng-icon hlm size="lg" name="lucideCamera" />
                </div>
                <div class="min-w-0 flex-1">
                  <p class="text-foreground truncate font-medium capitalize">{{ camera.make }}</p>
                  <p class="text-muted-foreground truncate text-sm">{{ camera.model }}</p>
                  <p class="text-muted-foreground text-xs">{{ camera.count }} photos</p>
                </div>
              </div>
            </a>
          }
        </div>
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CamerasList {
  protected readonly skeletonTiles = Array.from({ length: 6 }, (_, i) => i);
  private readonly trpc = injectTrpc();

  cameras = injectQuery(() => ({
    queryKey: [CacheKey.CamerasAll],
    queryFn: async () => this.trpc.camera.getAllCameras.query(),
  }));
}
