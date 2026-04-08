import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
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
            @if (encoderInfo.data().detectedEncoder === 'nvenc') {
              <span class="inline-flex items-center rounded bg-green-100 px-2 py-0.5 text-xs text-green-800 dark:bg-green-900/30">
                <span class="mr-1 inline-block h-2 w-2 rounded-full bg-green-500"></span>
                NVENC - {{ encoderInfo.data().gpuName }}
              </span>
            } @else if (encoderInfo.data().detectedEncoder === 'videotoolbox') {
              <span class="inline-flex items-center rounded bg-green-100 px-2 py-0.5 text-xs text-green-800 dark:bg-green-900/30">
                <span class="mr-1 inline-block h-2 w-2 rounded-full bg-green-500"></span>
                VideoToolbox - {{ encoderInfo.data().gpuName }}
              </span>
            } @else if (encoderInfo.data().detectedEncoder === 'vaapi') {
              <span class="inline-flex items-center rounded bg-green-100 px-2 py-0.5 text-xs text-green-800 dark:bg-green-900/30">
                <span class="mr-1 inline-block h-2 w-2 rounded-full bg-green-500"></span>
                VAAPI - {{ encoderInfo.data().gpuName }}
              </span>
            } @else if (encoderInfo.data().detectedEncoder === 'cpu') {
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
    });
  }

  hasQualityChanged(): boolean {
    return this.thumbQuality() !== this.originalThumbQuality || this.optQuality() !== this.originalOptQuality;
  }

  activeEncoderName(): string {
    const encoder = this.encoderInfo.data()?.detectedEncoder;
    const gpuEnabled = this.gpuEncoding();
    
    if (!encoder || encoder === 'none') return 'Unknown';
    
    if (gpuEnabled && encoder === 'nvenc') return 'h264_nvenc (GPU)';
    if (gpuEnabled && encoder === 'videotoolbox') return 'h264_videotoolbox (GPU)';
    if (gpuEnabled && encoder === 'vaapi') return 'h264_vaapi (GPU)';
    
    return 'libx264 (CPU)';
  }

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

  saveMutation = injectMutation(() => ({
    mutationFn: async () =>
      this.trpc.settings.update.mutate({
        encodingConcurrency: this.concurrency(),
        ioConcurrency: this.ioConcurrency(),
        thumbnailQuality: this.thumbQuality(),
        optimizedQuality: this.optQuality(),
        gpuEncoding: this.gpuEncoding(),
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
      this.queryClient.invalidateQueries({ queryKey: [CacheKey.MediaSourcesSettings] });
      this.queryClient.invalidateQueries({ queryKey: ['encoderInfo'] });
    },
  }));

  save() {
    this.saveMutation.mutate();
  }
}
