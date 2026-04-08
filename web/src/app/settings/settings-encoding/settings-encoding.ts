import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { ErrorAlert } from '@core/components/error/error';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';

@Component({
  selector: 'app-settings-encoding',
  standalone: true,
  imports: [HlmSpinner, HlmButton, ErrorAlert],
  template: `
    @if (settings.isPending()) {
      <hlm-spinner />
    }

    @if (settings.isError()) {
      <app-error-alert [error]="settings.error() || undefined" />
    }

    @if (settings.isSuccess()) {
      <div>
        <h1 class="text-foreground mb-2 block text-lg font-bold">Encoding Options</h1>
        <p class="text-muted-foreground mb-6 text-sm">Tune background encoding performance.</p>
      </div>

      <!-- Encoder Status Card -->
      <div class="hover:bg-accent/50 mb-6 grid max-w-lg gap-3 rounded-lg border p-3">
        <h2 class="text-foreground font-semibold">Hardware Status</h2>
        
        @if (encoderInfo.isSuccess()) {
          <div class="flex items-center gap-2">
            <span class="text-sm">Detected:</span>
            @if (hasGpuDetected()) {
              <span class="inline-flex items-center rounded bg-green-100 px-2 py-0.5 text-xs text-green-800 dark:bg-green-900/30">
                <span class="mr-1 inline-block h-2 w-2 rounded-full bg-green-500"></span>
                {{ primaryGpuName() }}
              </span>
            } @else if (encoderInfo.data().detectedGpus.length === 1 && encoderInfo.data().detectedGpus[0].id === 'cpu') {
              <span class="inline-flex items-center rounded bg-yellow-100 px-2 py-0.5 text-xs text-yellow-800 dark:bg-yellow-900/30">
                <span class="mr-1 inline-block h-2 w-2 rounded-full bg-yellow-500"></span>
                CPU Only (no GPU detected)
              </span>
            } @else {
              <span class="inline-flex items-center rounded bg-red-100 px-2 py-0.5 text-xs text-red-800 dark:bg-red-900/30">
                <span class="mr-1 inline-block h-2 w-2 rounded-full bg-red-500"></span>
                FFmpeg not available
              </span>
            }
          </div>

          <div class="text-muted-foreground text-xs">
            Active encoder: <span class="font-medium">{{ activeEncoderName() }}</span>
          </div>
        } @else {
          <div class="text-muted-foreground text-xs">Detecting hardware...</div>
        }
      </div>

      <div class="hover:bg-accent/50 mb-10 grid max-w-lg gap-3 rounded-lg border p-3">
        <h2 class="text-foreground font-semibold">Performance</h2>

        <div class="flex items-center justify-between">
          <label for="gpu-encoding" class="text-sm">GPU Video Encoding</label>
          <input
            id="gpu-encoding"
            type="checkbox"
            [checked]="gpuEncoding()"
            (change)="onGpuEncodingChange($any($event.target).checked)"
          />
        </div>
        <p class="text-muted-foreground text-xs">
          Use NVIDIA NVENC for video encoding (5-10x faster). Requires NVIDIA GPU with NVENC support.
          Falls back to CPU if unavailable.
        </p>

        @if (hasMultipleGpus() && gpuEncoding()) {
          <div class="flex items-center justify-between mt-2">
            <label for="gpu-select" class="text-sm">Select GPU</label>
            <select
              id="gpu-select"
              [value]="selectedGpu() ?? encoderInfo.data()?.defaultGpu"
              (change)="onGpuSelectChange($any($event.target).value)"
              class="text-sm border rounded px-2 py-1 bg-background"
            >
              @for (gpu of encoderInfo.data()?.detectedGpus; track gpu.id) {
                <option [value]="gpu.id">{{ gpu.name }}</option>
              }
            </select>
          </div>
          <p class="text-muted-foreground text-xs">Choose which GPU to use for encoding.</p>

          @if (isBetaGpu()) {
            <div class="mt-2 p-2 bg-yellow-500/10 border border-yellow-500/20 rounded">
              <p class="text-yellow-600 text-xs">
                <strong>Note:</strong> {{ selectedGpuName() }} support is experimental. NVIDIA NVENC is recommended for best compatibility.
              </p>
            </div>
          }
        }

        <div class="flex items-center justify-between mt-2">
          <label for="concurrency" class="text-sm">Encoding Concurrency</label>
          <span class="text-muted-foreground text-sm">{{ concurrency() }}</span>
        </div>
        <input
          id="concurrency"
          type="range"
          min="1"
          max="64"
          [value]="concurrency()"
          (input)="onEncodingChange($any($event.target).value)"
        />
        <p class="text-muted-foreground text-xs">Number of images to encode in parallel. Default is 2.</p>

        <div class="flex items-center justify-between mt-2">
          <label for="io-concurrency" class="text-sm">I/O Concurrency</label>
          <span class="text-muted-foreground text-sm">{{ ioConcurrency() }}</span>
        </div>
        <input
          id="io-concurrency"
          type="range"
          min="1"
          max="10"
          [value]="ioConcurrency()"
          (input)="onIoChange($any($event.target).value)"
        />
        <p class="text-muted-foreground text-xs">Limits simultaneous file reads/writes. Lower this if disk is slow. Default is 2.</p>
      </div>

      <div class="hover:bg-accent/50 mb-10 grid max-w-lg gap-3 rounded-lg border p-3">
        <h2 class="text-foreground font-semibold">Image Quality</h2>
        
        <div class="flex items-center justify-between">
          <label for="thumb-quality" class="text-sm">Thumbnail Quality</label>
          <span class="text-muted-foreground text-sm">{{ thumbQuality() }}%</span>
        </div>
        <input
          id="thumb-quality"
          type="range"
          min="10"
          max="100"
          [value]="thumbQuality()"
          (input)="onThumbQualityChange($any($event.target).value)"
        />
        <p class="text-muted-foreground text-xs">Quality for thumbnails (used in grids). Lower = smaller files. Default is 70.</p>

        <div class="flex items-center justify-between mt-2">
          <label for="opt-quality" class="text-sm">Optimized Quality</label>
          <span class="text-muted-foreground text-sm">{{ optQuality() }}%</span>
        </div>
        <input
          id="opt-quality"
          type="range"
          min="10"
          max="100"
          [value]="optQuality()"
          (input)="onOptQualityChange($any($event.target).value)"
        />
        <p class="text-muted-foreground text-xs">Quality for full-size optimized images. Higher = better quality but larger files. Default is 80.</p>
        
        @if (hasQualityChanged()) {
          <p class="text-amber-500 text-xs mt-2">Quality changed - images will be re-encoded on next scan or manually triggered.</p>
        }
      </div>

      <div>
        <button hlmBtn (click)="save()" [disabled]="saveMutation.isPending()">Save</button>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsEncoding {
  private trpc = injectTrpc();
  private queryClient = inject(QueryClient);

  settings = injectQuery(() => ({
    queryKey: [CacheKey.MediaSourcesSettings],
    queryFn: async () => this.trpc.settings.get.query(),
  }));

  encoderInfo = injectQuery(() => ({
    queryKey: ['encoderInfo'],
    queryFn: async () => this.trpc.settings.getEncoderInfo.query(),
  }));

  concurrency = signal<number>(2);
  ioConcurrency = signal<number>(2);
  thumbQuality = signal<number>(70);
  optQuality = signal<number>(80);
  gpuEncoding = signal<boolean>(false);
  selectedGpu = signal<string | null>(null);

  private originalThumbQuality = 70;
  private originalOptQuality = 80;

  constructor() {
    effect(() => {
      const data = this.settings.data();
      if (data?.encodingConcurrency) this.concurrency.set(data.encodingConcurrency);
      if (data?.ioConcurrency) this.ioConcurrency.set(data.ioConcurrency);
      if (data?.thumbnailQuality) {
        this.thumbQuality.set(data.thumbnailQuality);
        this.originalThumbQuality = data.thumbnailQuality;
      }
      if (data?.optimizedQuality) {
        this.optQuality.set(data.optimizedQuality);
        this.originalOptQuality = data.optimizedQuality;
      }
      if (data?.gpuEncoding !== undefined) this.gpuEncoding.set(data.gpuEncoding);
      if (data?.selectedGpu !== undefined) this.selectedGpu.set(data.selectedGpu);
    });
  }

  hasGpuDetected = computed(() => {
    const info = this.encoderInfo.data();
    return info?.detectedGpus?.some(g => g.id !== 'cpu') ?? false;
  });

  primaryGpuName = computed(() => {
    const info = this.encoderInfo.data();
    if (!info) return 'Unknown';
    // Find first non-CPU GPU
    const gpu = info.detectedGpus?.find(g => g.id !== 'cpu');
    return gpu?.name ?? 'No GPU';
  });

  hasQualityChanged(): boolean {
    return this.thumbQuality() !== this.originalThumbQuality || this.optQuality() !== this.originalOptQuality;
  }

  activeEncoderName = computed(() => {
    const info = this.encoderInfo.data();
    const selected = this.selectedGpu();
    if (!info) return 'Unknown';

    // Find the selected GPU info
    const gpu = info.detectedGpus?.find(g => g.id === selected);
    if (gpu) {
      return gpu.name;
    }

    // Fallback to default detection
    if (info.detectedGpus?.length > 0) {
      const defaultGpu = info.detectedGpus.find(g => g.id === info.defaultGpu);
      return defaultGpu?.name || 'Unknown';
    }

    return 'CPU (Software)';
  });

  hasMultipleGpus = computed(() => {
    const info = this.encoderInfo.data();
    return (info?.detectedGpus?.length ?? 0) > 1;
  });

  isBetaGpu = computed(() => {
    const selected = this.selectedGpu() ?? this.encoderInfo.data()?.defaultGpu;
    return selected === 'vaapi' || selected === 'videotoolbox';
  });

  selectedGpuName = computed(() => {
    const info = this.encoderInfo.data();
    const selected = this.selectedGpu() ?? info?.defaultGpu;
    const gpu = info?.detectedGpus?.find(g => g.id === selected);
    return gpu?.name ?? 'Unknown';
  });

  onEncodingChange(value: string) {
    const n = Number(value);
    if (Number.isFinite(n)) this.concurrency.set(Math.min(64, Math.max(1, n)));
  }

  onIoChange(value: string) {
    const n = Number(value);
    if (Number.isFinite(n)) this.ioConcurrency.set(Math.min(10, Math.max(1, n)));
  }

  onThumbQualityChange(value: string) {
    const n = Number(value);
    if (Number.isFinite(n)) this.thumbQuality.set(Math.min(100, Math.max(10, n)));
  }

  onOptQualityChange(value: string) {
    const n = Number(value);
    if (Number.isFinite(n)) this.optQuality.set(Math.min(100, Math.max(10, n)));
  }

  onGpuEncodingChange(checked: boolean) {
    this.gpuEncoding.set(checked);
  }

  onGpuSelectChange(value: string) {
    this.selectedGpu.set(value);
  }

  saveMutation = injectMutation(() => ({
    mutationFn: async () =>
      this.trpc.settings.update.mutate({
        encodingConcurrency: this.concurrency(),
        ioConcurrency: this.ioConcurrency(),
        thumbnailQuality: this.thumbQuality(),
        optimizedQuality: this.optQuality(),
        gpuEncoding: this.gpuEncoding(),
        selectedGpu: this.selectedGpu(),
      }),
    onSuccess: (data) => {
      if (data?.encodingConcurrency) this.concurrency.set(data.encodingConcurrency);
      if (data?.ioConcurrency) this.ioConcurrency.set(data.ioConcurrency);
      if (data?.thumbnailQuality) {
        this.thumbQuality.set(data.thumbnailQuality);
        this.originalThumbQuality = data.thumbnailQuality;
      }
      if (data?.optimizedQuality) {
        this.optQuality.set(data.optimizedQuality);
        this.originalOptQuality = data.optimizedQuality;
      }
      if (data?.gpuEncoding !== undefined) this.gpuEncoding.set(data.gpuEncoding);
      if (data?.selectedGpu !== undefined) this.selectedGpu.set(data.selectedGpu);
      this.queryClient.invalidateQueries({ queryKey: [CacheKey.MediaSourcesSettings] });
      this.queryClient.invalidateQueries({ queryKey: ['encoderInfo'] });
    },
  }));

  save() {
    this.saveMutation.mutate();
  }
}
