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
    @if (stats.isPending() || settings.isPending()) {
      <hlm-spinner />
    }

    @if (stats.isError()) {
      <app-error-alert [error]="stats.error()" />
    }

    @if (stats.isSuccess() && settings.isSuccess()) {
      <div>
        <h1 class="text-foreground mb-2 block text-lg font-bold">Storage</h1>
        <p class="text-muted-foreground mb-6 text-sm">
          View storage usage and location information.
        </p>
      </div>

      <!-- Storage Location -->
      <div class="bg-card mb-4 rounded-lg border p-4">
        <div class="flex items-center gap-3">
          <div class="rounded-lg bg-purple-500/10 p-2 text-purple-500">
            <ng-icon hlm size="lg" name="lucideHardDrive" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-muted-foreground text-sm">Storage Location</p>
            <p class="text-foreground truncate font-mono text-sm">
              {{ settings.data().uploadPath }}
            </p>
          </div>
        </div>
        <p class="text-muted-foreground mt-2 text-xs">
          Encoded images stored in <code class="bg-muted rounded px-1">images/YYYY/MM/DD/</code> and
          videos in
          <code class="bg-muted rounded px-1">videos/YYYY/MM/DD/</code>
        </p>
      </div>

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

  originalSize = computed(() => formatBytes(this.stats.data()?.original.totalSize ?? 0));
  originalCount = computed(() => this.stats.data()?.original.totalCount ?? 0);

  variantsSize = computed(() => formatBytes(this.stats.data()?.variants.totalSize ?? 0));
  variantsCount = computed(() => this.stats.data()?.variants.totalCount ?? 0);
}
