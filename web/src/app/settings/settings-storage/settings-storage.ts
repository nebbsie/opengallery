import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { ErrorAlert } from '@core/components/error/error';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideFolder, lucideHardDrive, lucideImages } from '@ng-icons/lucide';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { injectQuery } from '@tanstack/angular-query-experimental';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

@Component({
  selector: 'app-settings-storage',
  providers: [
    provideIcons({
      lucideFolder,
      lucideImages,
      lucideHardDrive,
    }),
  ],
  imports: [HlmSpinner, ErrorAlert, NgIcon, HlmIcon],
  host: {
    class: 'w-full',
  },
  template: `
    @if (stats.isPending() || settings.isPending() || sources.isPending()) {
      <hlm-spinner />
    }

    @if (stats.isError()) {
      <app-error-alert [error]="stats.error()" />
    }

    @if (sources.isError()) {
      <app-error-alert [error]="sources.error()" />
    }

    @if (stats.isSuccess() && settings.isSuccess() && sources.isSuccess()) {
      <div>
        <h1 class="text-foreground mb-2 block text-lg font-bold">Storage</h1>
        <p class="text-muted-foreground mb-6 text-sm">
          View storage usage and location information.
        </p>
      </div>

      <!-- Storage Locations -->
      <div class="bg-card mb-4 rounded-lg border p-4">
        <div class="flex items-center gap-3">
          <div class="rounded-lg bg-purple-500/10 p-2 text-purple-500">
            <ng-icon hlm size="lg" name="lucideHardDrive" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-muted-foreground text-sm">Uploads Location</p>
            <p class="text-foreground truncate font-mono text-sm">
              {{ settings.data().uploadPath }}
            </p>
          </div>
        </div>
        <p class="text-muted-foreground mt-2 text-xs">
          Where new uploads will be stored.
        </p>
      </div>

      @if (sources.data().paths.length > 0) {
        @for (path of sources.data().paths; track path.id) {
          <div class="bg-card mb-4 rounded-lg border p-4">
            <div class="flex items-center gap-3">
              <div class="rounded-lg bg-blue-500/10 p-2 text-blue-500">
                <ng-icon hlm size="lg" name="lucideFolder" />
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-muted-foreground text-sm">Source Folder</p>
                <p class="text-foreground truncate font-mono text-sm">
                  {{ path.path }}
                </p>
              </div>
            </div>
            <p class="text-muted-foreground mt-2 text-xs">
              Where existing media is scanned from.
            </p>
          </div>
        }
      }

      @if (settings.data().variantsPath) {
        <div class="bg-card mb-4 rounded-lg border p-4">
          <div class="flex items-center gap-3">
            <div class="rounded-lg bg-green-500/10 p-2 text-green-500">
              <ng-icon hlm size="lg" name="lucideImages" />
            </div>
            <div class="min-w-0 flex-1">
              <p class="text-muted-foreground text-sm">Encoded Files Location</p>
              <p class="text-foreground truncate font-mono text-sm">
                {{ settings.data().variantsPath }}
              </p>
            </div>
          </div>
          <p class="text-muted-foreground mt-2 text-xs">
            Where thumbnails and optimized images are stored.
          </p>
        </div>
      }

      <div class="grid gap-4 md:grid-cols-2">
        <!-- Raw Storage Card -->
        <div class="bg-card rounded-lg border p-4">
          <div class="mb-3 flex items-center gap-3">
            <div class="rounded-lg bg-blue-500/10 p-2 text-blue-500">
              <ng-icon hlm size="lg" name="lucideFolder" />
            </div>
            <div>
              <p class="text-muted-foreground text-sm">Raw Storage</p>
              <p class="text-foreground text-2xl font-bold">{{ originalSize() }}</p>
            </div>
          </div>
          <p class="text-muted-foreground text-xs">{{ originalCount() }} source files</p>
        </div>

        <!-- Optimised Storage Card -->
        <div class="bg-card rounded-lg border p-4">
          <div class="mb-3 flex items-center gap-3">
            <div class="rounded-lg bg-green-500/10 p-2 text-green-500">
              <ng-icon hlm size="lg" name="lucideImages" />
            </div>
            <div>
              <p class="text-muted-foreground text-sm">Optimised Storage</p>
              <p class="text-foreground text-2xl font-bold">{{ variantsSize() }}</p>
            </div>
          </div>
          <p class="text-muted-foreground text-xs">{{ variantsCount() }} generated files</p>
        </div>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsStorage {
  private trpc = injectTrpc();

  stats = injectQuery(() => ({
    queryKey: [CacheKey.StorageStats],
    queryFn: async () => this.trpc.settings.getStorageStats.query(),
  }));

  settings = injectQuery(() => ({
    queryKey: [CacheKey.SystemSettings],
    queryFn: async () => this.trpc.settings.get.query(),
  }));

  sources = injectQuery(() => ({
    queryKey: [CacheKey.MediaSourcesSettings],
    queryFn: async () => this.trpc.mediaSourcesSettings.get.query(),
  }));

  originalSize = computed(() => formatBytes(this.stats.data()?.original.totalSize ?? 0));
  originalCount = computed(() => this.stats.data()?.original.totalCount ?? 0);

  variantsSize = computed(() => formatBytes(this.stats.data()?.variants.totalSize ?? 0));
  variantsCount = computed(() => this.stats.data()?.variants.totalCount ?? 0);
}
