import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { ErrorAlert } from '@core/components/error/error';
import { Confirm } from '@core/dialogs/confirm/confirm';
import { PathSelect } from '@core/dialogs/path-select/path-select';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideFolder, lucideHardDrive, lucideImages, lucideTrash2 } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';

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
      lucideTrash2,
    }),
  ],
  imports: [HlmSpinner, ErrorAlert, NgIcon, HlmIcon, HlmButton, HlmInput, ReactiveFormsModule],
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
          Manage storage locations for uploads and encoded files.
        </p>
      </div>

      <!-- Source Folders (Read Only) -->
      <div class="mb-3 flex items-center justify-between gap-4">
        <div>
          <h2 class="text-foreground block text-lg font-bold">Source Folders</h2>
          <p class="text-muted-foreground text-sm">
            Locations where media is scanned from. Manage these in Folder Settings.
          </p>
        </div>
      </div>

      @if (sources.data().paths.length > 0) {
        @for (path of sources.data().paths; track path.id) {
          <div class="bg-card mb-4 flex max-w-lg items-center gap-3 rounded-lg border p-4">
            <div class="rounded-lg bg-blue-500/10 p-2 text-blue-500">
              <ng-icon hlm size="lg" name="lucideFolder" />
            </div>
            <div class="min-w-0 flex-1">
              <p class="text-foreground truncate font-mono text-sm">{{ path.path }}</p>
            </div>
          </div>
        }
      } @else {
        <p class="text-muted-foreground mb-6 text-sm italic">No source folders configured.</p>
      }

      <!-- Uploads Location -->
      <div class="mb-3 flex items-center justify-between gap-4">
        <div>
          <h2 class="text-foreground block text-lg font-bold">Uploads Location</h2>
          <p class="text-muted-foreground text-sm">
            Where new uploads will be stored. Required for video encoding.
          </p>
        </div>
      </div>

      @if (uploadPath(); as up) {
        <div class="mb-4 flex max-w-lg gap-x-2">
          <input [value]="up" hlmInput type="text" disabled />
          <button
            class="text-foreground"
            hlmBtn
            variant="ghost"
            size="icon"
            (click)="clearUploadPath()"
          >
            <ng-icon hlm size="sm" name="lucideTrash2" />
          </button>
        </div>
      } @else {
        <p class="text-muted-foreground mb-4 text-sm italic">No upload path set. Defaults to source path/uploads when added.</p>
      }

      <button class="mb-10" hlmBtn variant="outline" (click)="setUploadPath()">
        {{ uploadPath() ? 'Change Upload Path' : 'Add Upload Path' }}
      </button>

      <!-- Encoded Files Location -->

      <!-- Encoded Files Location -->
      <div class="mb-3 flex items-center justify-between gap-4">
        <div>
          <h2 class="text-foreground block text-lg font-bold">Encoded Files Location</h2>
          <p class="text-muted-foreground text-sm">
            Where thumbnails and optimized videos are stored.
          </p>
        </div>
      </div>

      @if (variantsPath(); as vp) {
        <div class="mb-4 flex max-w-lg gap-x-2">
          <input [value]="vp" hlmInput type="text" disabled />
          <button
            class="text-foreground"
            hlmBtn
            variant="ghost"
            size="icon"
            (click)="clearVariantsPath()"
          >
            <ng-icon hlm size="sm" name="lucideTrash2" />
          </button>
        </div>
      } @else {
        <p class="text-muted-foreground mb-4 text-sm italic">No encode path set. Defaults to source path/encodes when added.</p>
      }

      <button class="mb-10" hlmBtn variant="outline" (click)="setVariantsPath()">
        {{ variantsPath() ? 'Change Encoded Path' : 'Add Encoded Path' }}
      </button>

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
  private queryClient = inject(QueryClient);
  private dialog = inject(HlmDialogService);

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

  uploadPath = signal<string | null>(null);
  variantsPath = signal<string | null>(null);

  private previousUploadPath: string | null | undefined;
  private previousVariantsPath: string | null | undefined;

  constructor() {
    // Effect to sync form controls with settings data
    effect(() => {
      const data = this.settings.data();
      if (data) {
        // Only update if changed to avoid cursor jumping
        const up = data.uploadPath || null;
        const vp = data.variantsPath || null;
        if (up !== this.previousUploadPath) {
          this.previousUploadPath = up;
          this.uploadPath.set(up);
        }
        if (vp !== this.previousVariantsPath) {
          this.previousVariantsPath = vp;
          this.variantsPath.set(vp);
        }
      }
    });

    // Separate effect for auto-setting defaults
    effect(() => {
      const data = this.settings.data();
      const sourcesData = this.sources.data();

      // Wait for both to be loaded
      if (!data || !sourcesData) return;

      // Only proceed if we have sources but missing paths
      if (!sourcesData.paths?.length) return;
      if (data.uploadPath && data.variantsPath) return;

      const firstSource = sourcesData.paths[0].path;
      const hasNoUploadPath = !data.uploadPath;
      const hasNoVariantsPath = !data.variantsPath;

      console.log('[Storage Settings] Auto-default effect running:', {
        firstSource,
        currentUploadPath: data.uploadPath,
        currentVariantsPath: data.variantsPath,
        hasNoUploadPath,
        hasNoVariantsPath,
      });

      if (hasNoUploadPath || hasNoVariantsPath) {
        // Use platform detection - Windows paths need backslash
        const isWindows = typeof navigator !== 'undefined' && navigator.platform?.toLowerCase().includes('win');
        const sep = isWindows ? '\\' : '/';
        const uploadPath = hasNoUploadPath ? `${firstSource}${sep}uploads` : data.uploadPath;
        const variantsPath = hasNoVariantsPath ? `${firstSource}${sep}encodes` : data.variantsPath;

        console.log('[Storage Settings] Setting defaults:', { uploadPath, variantsPath, sep });

        // Update immediately without waiting for user
        this.trpc.settings.update.mutate({
          uploadPath,
          variantsPath,
        }).then(() => {
          this.queryClient.invalidateQueries({ queryKey: [CacheKey.SystemSettings] });
        });
      }
    });
  }

  setUploadPath() {
    this.dialog
      .open(PathSelect, { contentClass: 'sm:max-w-[640px]' })
      .closed$.subscribe((path: string | null) => {
        if (path) {
          this.uploadPath.set(path);
          this.savePaths();
        }
      });
  }

  setVariantsPath() {
    this.dialog
      .open(PathSelect, { contentClass: 'sm:max-w-[640px]' })
      .closed$.subscribe((path: string | null) => {
        if (path) {
          this.variantsPath.set(path);
          this.savePaths();
        }
      });
  }

  clearUploadPath() {
    console.log('[Storage Settings] Clearing upload path, current value:', this.uploadPath());
    this.dialog
      .open(Confirm, {
        context: {
          message: 'Clear the uploads path? Encoded files will fail until a new path is set.',
        },
      })
      .closed$.subscribe((res: boolean) => {
        console.log('[Storage Settings] Confirm dialog result:', res);
        if (res) {
          this.uploadPath.set(null);
          console.log('[Storage Settings] Upload path set to null, calling savePaths');
          this.savePaths();
        }
      });
  }

  clearVariantsPath() {
    console.log('[Storage Settings] Clearing variants path, current value:', this.variantsPath());
    this.dialog
      .open(Confirm, {
        context: {
          message: 'Clear the encoded files path? Will fall back to uploads location.',
        },
      })
      .closed$.subscribe((res: boolean) => {
        console.log('[Storage Settings] Confirm dialog result:', res);
        if (res) {
          this.variantsPath.set(null);
          console.log('[Storage Settings] Variants path set to null, calling savePaths');
          this.savePaths();
        }
      });
  }

  private savePaths() {
    const up = this.uploadPath();
    const vp = this.variantsPath();
    console.log('[Storage Settings] Saving paths:', { uploadPath: up, variantsPath: vp });
    this.trpc.settings.update.mutate({
      uploadPath: up,
      variantsPath: vp,
    }).then(() => {
      this.queryClient.invalidateQueries({ queryKey: [CacheKey.SystemSettings], refetchType: 'all' });
      this.queryClient.invalidateQueries({ queryKey: [CacheKey.StorageStats], refetchType: 'all' });
    });
  }

  originalSize = computed(() => formatBytes(this.stats.data()?.original.totalSize ?? 0));
  originalCount = computed(() => this.stats.data()?.original.totalCount ?? 0);

  variantsSize = computed(() => formatBytes(this.stats.data()?.variants.totalSize ?? 0));
  variantsCount = computed(() => this.stats.data()?.variants.totalCount ?? 0);
}
