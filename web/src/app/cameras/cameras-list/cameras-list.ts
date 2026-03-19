import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ErrorAlert } from '@core/components/error/error';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCamera } from '@ng-icons/lucide';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { injectQuery } from '@tanstack/angular-query-experimental';

@Component({
  selector: 'app-cameras-list',
  providers: [provideIcons({ lucideCamera })],
  imports: [ErrorAlert, HlmSpinner, NgIcon, HlmIcon, RouterLink],
  host: { class: 'block h-full overflow-y-auto' },
  template: `
    @if (cameras.isPending() && !cameras.data()) {
      <hlm-spinner />
    } @else if (cameras.isError() && !cameras.data()) {
      <app-error-alert [error]="cameras.error()" />
    } @else {
      <div class="mb-6">
        <h1 class="text-foreground mb-2 text-2xl font-bold">Cameras</h1>
        <p class="text-muted-foreground text-sm">Browse photos by camera that captured them</p>
      </div>

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
              class="bg-card hover:bg-accent group rounded-lg border p-4 transition-colors"
            >
              <div class="flex items-center gap-3">
                <div class="bg-primary/10 text-primary rounded-lg p-3">
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
  private readonly trpc = injectTrpc();

  cameras = injectQuery(() => ({
    queryKey: [CacheKey.CamerasAll],
    queryFn: async () => this.trpc.camera.getAllCameras.query(),
  }));
}
