import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  signal,
} from '@angular/core';
import { ErrorAlert } from '@core/components/error/error';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { HlmButton } from '@spartan-ng/helm/button';
import { Loading } from '@core/components/loading/loading';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';

const MIN_THRESHOLD = 0.2;
const MAX_THRESHOLD = 0.7;
const DEFAULT_THRESHOLD = 0.4;

@Component({
  selector: 'app-settings-faces',
  standalone: true,
  imports: [Loading, HlmButton, ErrorAlert],
  template: `
    <div class="min-h-0 flex-1 overflow-y-auto">
      @if (settings.isPending()) {
        <app-loading />
      }

      @if (settings.isError()) {
        <app-error-alert [error]="settings.error() || undefined" />
      }

      @if (settings.isSuccess()) {
        <div>
          <h1 class="text-foreground mb-2 block text-lg font-bold">People &amp; Faces</h1>
          <p class="text-muted-foreground mb-6 text-sm">
            Tune how faces are grouped into people, and rebuild the results from scratch.
          </p>
        </div>

        <!-- Match strictness -->
        <div class="hover:bg-accent/50 mb-6 grid max-w-lg gap-3 rounded-lg border p-3">
          <h2 class="text-foreground font-semibold">Match strictness</h2>

          <div class="flex items-center justify-between">
            <label for="threshold" class="text-sm">Strictness</label>
            <span class="text-muted-foreground text-sm">{{ threshold().toFixed(2) }}</span>
          </div>
          <input
            id="threshold"
            type="range"
            [min]="minThreshold"
            [max]="maxThreshold"
            step="0.01"
            [value]="threshold()"
            (input)="onThresholdChange($any($event.target).value)"
          />
          <div class="text-muted-foreground flex justify-between text-xs">
            <span>Looser (fewer clusters)</span>
            <span>Stricter (purer clusters)</span>
          </div>
          <p class="text-muted-foreground text-xs">
            How similar two faces must be to count as the same person. Higher is stricter: it
            avoids merging different people, but the same person may occasionally split into more
            than one group (which you can merge). Default is {{ defaultThreshold.toFixed(2) }}.
            Changes apply to faces scanned after saving — use Rescan below to re-cluster everything.
          </p>

          <div class="mt-1">
            <button hlmBtn (click)="save()" [disabled]="saveMutation.isPending()">Save</button>
          </div>
        </div>

        <!-- Rescan -->
        <div class="mb-10 grid max-w-lg gap-3 rounded-lg border border-red-500/20 p-3">
          <h2 class="text-foreground font-semibold">Rescan all faces</h2>
          <p class="text-muted-foreground text-xs">
            Deletes every detected person and face (and their avatar crops), then re-queues face
            detection for your whole library. Use this after changing strictness. Naming and manual
            merges will be lost. This cannot be undone.
          </p>

          @if (rescanMutation.data(); as r) {
            <p class="text-xs text-green-600">
              Cleared {{ r.peopleDeleted }} people and {{ r.facesDeleted }} faces;
              {{ r.tasksReset }} photos queued for rescan.
            </p>
          }
          @if (rescanMutation.isError()) {
            <app-error-alert [error]="rescanMutation.error() || undefined" />
          }

          @if (!confirming()) {
            <div>
              <button
                hlmBtn
                variant="destructive"
                (click)="confirming.set(true)"
                [disabled]="rescanMutation.isPending()"
              >
                {{ rescanMutation.isPending() ? 'Rescanning…' : 'Rescan all faces' }}
              </button>
            </div>
          } @else {
            <div class="flex items-center gap-2">
              <span class="text-sm">Delete all people &amp; faces and rescan?</span>
              <button hlmBtn variant="destructive" size="sm" (click)="rescan()">
                Yes, rescan
              </button>
              <button hlmBtn variant="ghost" size="sm" (click)="confirming.set(false)">
                Cancel
              </button>
            </div>
          }
        </div>
      }
    </div>
  `,
  host: {
    class: 'flex flex-col w-full h-full min-h-0 overflow-hidden',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsFaces {
  private trpc = injectTrpc();
  private queryClient = inject(QueryClient);

  protected readonly minThreshold = MIN_THRESHOLD;
  protected readonly maxThreshold = MAX_THRESHOLD;
  protected readonly defaultThreshold = DEFAULT_THRESHOLD;

  threshold = signal<number>(DEFAULT_THRESHOLD);
  confirming = signal(false);

  settings = injectQuery(() => ({
    queryKey: [CacheKey.MediaSourcesSettings],
    queryFn: async () => this.trpc.settings.get.query(),
  }));

  constructor() {
    effect(() => {
      const data = this.settings.data();
      if (data?.faceMatchThreshold != null) this.threshold.set(data.faceMatchThreshold);
    });
  }

  onThresholdChange(value: string) {
    const n = Number(value);
    if (Number.isFinite(n)) {
      this.threshold.set(Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, n)));
    }
  }

  saveMutation = injectMutation(() => ({
    mutationFn: async () =>
      this.trpc.settings.update.mutate({ faceMatchThreshold: this.threshold() }),
    onSuccess: (data) => {
      if (data?.faceMatchThreshold != null) this.threshold.set(data.faceMatchThreshold);
      this.queryClient.invalidateQueries({ queryKey: [CacheKey.MediaSourcesSettings] });
    },
  }));

  rescanMutation = injectMutation(() => ({
    mutationFn: async () => this.trpc.faces.rescanAll.mutate(),
    onSuccess: () => {
      this.confirming.set(false);
      this.queryClient.invalidateQueries({ queryKey: [CacheKey.FacesAll] });
    },
  }));

  save() {
    this.saveMutation.mutate();
  }

  rescan() {
    this.rescanMutation.mutate();
  }
}
