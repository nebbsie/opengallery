import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { ErrorAlert } from '@core/components/error/error';
import { CacheKey, FACE_CACHE_KEYS } from '@core/services/cache-key.types';
import { ToastService } from '@core/services/toast/toast';
import { injectTrpc, RouterOutputs } from '@core/services/trpc';
import { HlmButton } from '@spartan-ng/helm/button';
import { Loading } from '@core/components/loading/loading';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';

const MIN_THRESHOLD = 0.2;
const MAX_THRESHOLD = 0.7;
const DEFAULT_THRESHOLD = 0.4;
const POLL_MS = 3000;

type FaceStatus = RouterOutputs['faces']['status'];

@Component({
  selector: 'app-settings-faces',
  standalone: true,
  imports: [Loading, HlmButton, ErrorAlert, DatePipe],
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
          <h1 class="text-foreground mb-2 block text-lg font-bold">People and faces</h1>
          <p class="text-muted-foreground mb-6 text-sm text-pretty">
            See how face grouping is going, group faces again, and tune how strict the grouping is.
          </p>
        </div>

        <!-- Status -->
        <section class="mb-6 grid max-w-lg gap-3 rounded-lg border p-3" aria-labelledby="faces-status">
          <div class="flex items-center gap-2">
            <h2 id="faces-status" class="text-foreground font-semibold">Status</h2>
            @if (status.data()?.reclusterRunning) {
              <span class="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs font-medium">
                Grouping now
              </span>
            } @else if ((status.data()?.pendingDetect ?? 0) > 0) {
              <span class="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs font-medium">
                Scanning photos
              </span>
            }
          </div>
          @if (status.isError()) {
            <app-error-alert [error]="status.error() || undefined" />
          }
          <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3" aria-live="polite">
            @for (row of statusRows(); track row.label) {
              <div class="flex flex-col">
                <dt class="text-muted-foreground text-xs">{{ row.label }}</dt>
                <dd class="text-foreground font-medium tabular-nums">
                  @if (status.isPending()) {
                    <span class="bg-muted inline-block h-4 w-12 animate-pulse rounded align-middle"></span>
                  } @else {
                    {{ row.value }}
                  }
                </dd>
              </div>
            }
          </dl>
          <p class="text-muted-foreground text-xs">
            Face model: <span class="text-foreground">{{ status.data()?.model || 'Unknown' }}</span>.
            Last grouped:
            <span class="text-foreground">
              @if (status.data()?.lastReclusterAt; as at) {
                {{ at | date: 'medium' }}
              } @else {
                never
              }
            </span>
          </p>
          <div class="flex flex-wrap items-center gap-2">
            <button
              hlmBtn
              variant="outline"
              class="h-11 active:scale-[0.96] sm:h-9"
              [disabled]="reclusterMutation.isPending() || status.data()?.reclusterRunning"
              (click)="reclusterMutation.mutate()"
            >
              {{ status.data()?.reclusterRunning ? 'Grouping faces' : 'Regroup faces now' }}
            </button>
            <p class="text-muted-foreground text-xs text-pretty">
              Groups all faces into people again. Names and your answers stay.
            </p>
          </div>
          @if (reclusterMutation.isError()) {
            <app-error-alert [error]="reclusterMutation.error() || undefined" />
          }
        </section>

        <!-- Match strictness -->
        <section class="mb-6 grid max-w-lg gap-3 rounded-lg border p-3" aria-labelledby="faces-strict">
          <h2 id="faces-strict" class="text-foreground font-semibold">Match strictness</h2>

          <div class="flex items-center justify-between">
            <label for="threshold" class="text-sm">How alike two faces must look</label>
            <span class="text-muted-foreground text-sm tabular-nums">{{ threshold().toFixed(2) }}</span>
          </div>
          <input
            id="threshold"
            type="range"
            class="min-h-11"
            [min]="minThreshold"
            [max]="maxThreshold"
            step="0.01"
            [value]="threshold()"
            [attr.aria-valuetext]="strictnessText()"
            (input)="onThresholdChange($any($event.target).value)"
          />
          <div class="text-muted-foreground flex justify-between text-xs">
            <span>Looser</span>
            <span>Stricter</span>
          </div>
          <ul class="text-muted-foreground list-disc space-y-1 pl-4 text-xs text-pretty">
            <li>
              Move it left if one person shows up as many people. The app then puts more faces
              together, but it can mix up people who look alike.
            </li>
            <li>
              Move it right if different people end up in one group. Each group is then cleaner,
              but one person can show up more than once (you can merge them).
            </li>
            <li>The default is {{ defaultThreshold.toFixed(2) }}. Save, then regroup faces to see the change.</li>
          </ul>

          <div class="mt-1 flex gap-2">
            <button
              hlmBtn
              class="h-11 active:scale-[0.96] sm:h-9"
              (click)="save()"
              [disabled]="saveMutation.isPending()"
            >
              Save
            </button>
            @if (threshold() !== defaultThreshold) {
              <button
                hlmBtn
                variant="ghost"
                class="h-11 sm:h-9"
                (click)="threshold.set(defaultThreshold)"
              >
                Reset to default
              </button>
            }
          </div>
          @if (saveMutation.isError()) {
            <app-error-alert [error]="saveMutation.error() || undefined" />
          }
        </section>

        <!-- Rescan -->
        <section
          class="border-destructive/30 mb-10 grid max-w-lg gap-3 rounded-lg border p-3"
          aria-labelledby="faces-rescan"
        >
          <h2 id="faces-rescan" class="text-foreground font-semibold">Scan all photos again</h2>
          <p class="text-muted-foreground text-xs text-pretty">
            Runs face detection again on every photo with the current face model ({{
              status.data()?.model || 'unknown'
            }}). Names and your answers stay: each new face keeps the person of the old face in the
            same spot. On a big library this takes a long time (hours), and People can look
            incomplete until it ends.
          </p>

          @if (rescanMutation.isSuccess()) {
            <p class="text-xs text-green-700 dark:text-green-400">
              Scan started. "Photos to scan" above counts down as it runs.
            </p>
          }
          @if (rescanMutation.isError()) {
            <app-error-alert [error]="rescanMutation.error() || undefined" />
          }

          @if (!confirming()) {
            <div>
              <button
                hlmBtn
                variant="outline"
                class="h-11 active:scale-[0.96] sm:h-9"
                (click)="confirming.set(true)"
                [disabled]="rescanMutation.isPending()"
              >
                {{ rescanMutation.isPending() ? 'Starting scan' : 'Scan all photos again' }}
              </button>
            </div>
          } @else {
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-sm text-pretty">
                Scan every photo again? Names and answers stay. This can take hours.
              </span>
              <button
                hlmBtn
                variant="destructive"
                class="h-11 active:scale-[0.96] sm:h-8"
                (click)="rescan()"
                [disabled]="rescanMutation.isPending()"
              >
                {{ rescanMutation.isPending() ? 'Starting scan' : 'Yes, scan again' }}
              </button>
              <button hlmBtn variant="ghost" class="h-11 sm:h-8" (click)="confirming.set(false)">
                Cancel
              </button>
            </div>
          }
        </section>
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
  private toast = inject(ToastService);

  protected readonly minThreshold = MIN_THRESHOLD;
  protected readonly maxThreshold = MAX_THRESHOLD;
  protected readonly defaultThreshold = DEFAULT_THRESHOLD;

  threshold = signal<number>(DEFAULT_THRESHOLD);
  confirming = signal(false);

  settings = injectQuery(() => ({
    queryKey: [CacheKey.SystemSettings],
    queryFn: async () => this.trpc.settings.get.query(),
  }));

  // Poll while work is running, so the numbers move without a reload.
  status = injectQuery(() => ({
    queryKey: [CacheKey.FaceStatus],
    queryFn: async (): Promise<FaceStatus> => this.trpc.faces.status.query(),
    refetchInterval: (query: { state: { data?: FaceStatus } }) => {
      const d = query.state.data;
      return d && (d.reclusterRunning || d.pendingDetect > 0) ? POLL_MS : false;
    },
  }));

  protected readonly statusRows = computed(() => {
    const d = this.status.data();
    const n = (v: number | undefined) => (v ?? 0).toLocaleString();
    return [
      { label: 'Faces', value: n(d?.faces) },
      { label: 'People', value: n(d?.people) },
      { label: 'Named people', value: n(d?.named) },
      { label: 'Faces with no person', value: n(d?.unclustered) },
      { label: 'Photos to scan', value: n(d?.pendingDetect) },
    ];
  });

  protected readonly strictnessText = computed(() => {
    const t = this.threshold();
    const word = t < DEFAULT_THRESHOLD - 0.05 ? 'looser' : t > DEFAULT_THRESHOLD + 0.05 ? 'stricter' : 'about default';
    return `${t.toFixed(2)}, ${word}`;
  });

  constructor() {
    effect(() => {
      const data = this.settings.data();
      if (data?.faceMatchThreshold != null) this.threshold.set(data.faceMatchThreshold);
    });

    // When a regroup ends, refresh every face list once.
    let wasRunning = false;
    effect(() => {
      const running = this.status.data()?.reclusterRunning ?? false;
      if (wasRunning && !running) {
        this.invalidateFaces();
        this.toast.success('Faces regrouped');
      }
      wasRunning = running;
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
      this.queryClient.invalidateQueries({ queryKey: [CacheKey.SystemSettings] });
      this.toast.success('Strictness saved. Regroup faces to use it.');
    },
  }));

  reclusterMutation = injectMutation(() => ({
    mutationFn: async () => this.trpc.faces.recluster.mutate(),
    onSuccess: (r) => {
      this.toast.show(r.started ? 'Regrouping faces' : 'Faces are already being regrouped');
      this.queryClient.invalidateQueries({ queryKey: [CacheKey.FaceStatus] });
    },
  }));

  rescanMutation = injectMutation(() => ({
    mutationFn: async () => this.trpc.faces.rescanAll.mutate(),
    onSuccess: () => {
      this.confirming.set(false);
      this.toast.show('Scan started. This can take hours.');
      this.queryClient.invalidateQueries({ queryKey: [CacheKey.FaceStatus] });
      this.invalidateFaces();
    },
  }));

  save() {
    this.saveMutation.mutate();
  }

  rescan() {
    this.rescanMutation.mutate();
  }

  private invalidateFaces() {
    for (const key of FACE_CACHE_KEYS) {
      this.queryClient.invalidateQueries({ queryKey: [key] });
    }
  }
}
