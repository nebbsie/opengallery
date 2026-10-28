import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ErrorAlert } from '@core/components/error/error';
import { injectTrpc } from '@core/services/trpc';
import { Loading } from '@core/components/loading/loading';
import { ToastService } from '@core/services/toast/toast';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';

// Friendly names for the known task types; unknown types fall back to the raw key.
const TASK_LABELS: Record<string, string> = {
  encode_thumbnail: 'Thumbnails',
  encode_optimised: 'Optimised images',
  encode_video: 'Video encoding',
  video_poster: 'Video posters',
  detect_faces: 'Face detection',
  extract_geolocation: 'GPS locations',
};

@Component({
  selector: 'app-settings-tasks',
  imports: [Loading, ErrorAlert],
  host: { class: 'flex flex-col w-full h-full overflow-hidden' },
  template: `
    <div class="flex shrink-0 items-center justify-between gap-4 pb-3">
      <div>
        <h1 class="text-foreground block text-lg font-bold">Background Tasks</h1>
        <p class="text-muted-foreground text-sm">
          Processing progress per task type. Refreshes automatically.
        </p>
      </div>
      @if (tasks.isSuccess()) {
        <div class="text-muted-foreground grid justify-items-end gap-1 text-right text-sm">
          <span class="bg-muted rounded px-2 py-1 font-mono tabular-nums">
            {{ tasks.data().totals.remaining.toLocaleString() }} remaining
          </span>
          @if (tasks.data().totals.remaining > 0) {
            <span class="tabular-nums">{{ eta(tasks.data().totals.etaSeconds) }}</span>
          }
        </div>
      }
    </div>

    @if (tasks.isPending()) {
      <app-loading />
    }

    @if (tasks.isError()) {
      <app-error-alert [error]="tasks.error()" />
    }

    @if (tasks.isSuccess()) {
      @if (tasks.data().types.length === 0) {
        <p class="text-muted-foreground">No tasks yet.</p>
      } @else {
        <div class="min-h-0 flex-1 space-y-3 overflow-y-auto">
          @for (t of tasks.data().types; track t.type) {
            <div class="grid gap-2 rounded-lg border p-3">
              <div class="flex items-center justify-between">
                <span class="text-foreground font-semibold">{{ label(t.type) }}</span>
                <span class="text-muted-foreground text-sm tabular-nums">
                  {{ t.succeeded.toLocaleString() }} / {{ t.total.toLocaleString() }} done
                </span>
              </div>

              <div class="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                <div
                  class="h-full bg-green-500 transition-[width] duration-300"
                  [style.width.%]="percent(t)"
                ></div>
              </div>

              <div class="flex flex-wrap items-center gap-2 text-xs">
                <span class="text-foreground font-medium tabular-nums">{{ t.remaining.toLocaleString() }} remaining</span>
                @if (t.remaining > 0) {
                  <span class="text-muted-foreground tabular-nums">
                    {{ eta(t.etaSeconds) }}@if (t.perMinute > 0) {, {{ rate(t.perMinute) }}}
                  </span>
                }
                @if (t.pending > 0) {
                  <span class="rounded bg-yellow-100 px-1.5 py-0.5 text-yellow-800 tabular-nums dark:bg-yellow-900/30">
                    {{ t.pending }} waiting
                  </span>
                }
                @if (t.inProgress > 0) {
                  <span class="rounded bg-blue-100 px-1.5 py-0.5 text-blue-800 tabular-nums dark:bg-blue-900/30">
                    {{ t.inProgress }} in progress
                  </span>
                }
                @if (t.failed > 0) {
                  <span class="rounded bg-red-100 px-1.5 py-0.5 text-red-800 tabular-nums dark:bg-red-900/30">
                    {{ t.failed.toLocaleString() }} failed
                  </span>
                  <button
                    type="button"
                    class="hover:bg-accent focus-visible:ring-ring rounded border px-2 py-1 font-medium focus-visible:ring-2 focus-visible:outline-none active:scale-[0.96] disabled:opacity-50"
                    [disabled]="busy() === t.type + ':failed'"
                    (click)="retry(t.type, 'failed')"
                  >
                    Retry failed
                  </button>
                }
                @if (t.skipped > 0) {
                  <span class="bg-muted text-muted-foreground rounded px-1.5 py-0.5 tabular-nums">
                    {{ t.skipped.toLocaleString() }} skipped
                  </span>
                  <button
                    type="button"
                    class="hover:bg-accent focus-visible:ring-ring rounded border px-2 py-1 font-medium focus-visible:ring-2 focus-visible:outline-none active:scale-[0.96] disabled:opacity-50"
                    [disabled]="busy() === t.type + ':skipped'"
                    [title]="skippedHelp(t.type)"
                    (click)="retry(t.type, 'skipped')"
                  >
                    Check skipped again
                  </button>
                }
              </div>
            </div>
          }
        </div>
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsTasks {
  private readonly trpc = injectTrpc();
  private readonly toast = inject(ToastService);
  private readonly queryClient = inject(QueryClient);
  protected readonly busy = signal<string | null>(null);

  tasks = injectQuery(() => ({
    queryKey: ['fileTasks', 'summary'],
    queryFn: () => this.trpc.fileTask.summary.query(),
    refetchInterval: 5000,
  }));

  protected label(type: string): string {
    return TASK_LABELS[type] ?? type;
  }

  protected async retry(type: string, status: 'failed' | 'skipped'): Promise<void> {
    this.busy.set(`${type}:${status}`);
    try {
      const { requeued } = await this.trpc.fileTask.retry.mutate({ type, status });
      this.toast.success(`${requeued.toLocaleString()} ${this.label(type).toLowerCase()} task${requeued === 1 ? '' : 's'} queued again`);
      await this.queryClient.invalidateQueries({ queryKey: ['fileTasks'] });
    } catch {
      this.toast.error('Could not queue the tasks again. Try again.');
    } finally {
      this.busy.set(null);
    }
  }

  protected skippedHelp(type: string): string {
    return type === 'extract_geolocation'
      ? 'Skipped files had no GPS data when they were read. Check them again after an app update.'
      : 'Skipped files were not suitable for this task. Check them again after an app update.';
  }

  // "About 2 h 15 min left", from the recent finish rate.
  protected eta(seconds: number | null): string {
    if (seconds === null) return 'Working out the time left';
    if (seconds < 60) return 'Less than a minute left';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `About ${minutes} min left`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    if (hours >= 48) return `About ${Math.round(hours / 24)} days left`;
    return rest > 0 ? `About ${hours} h ${rest} min left` : `About ${hours} h left`;
  }

  protected rate(perMinute: number): string {
    return perMinute >= 1 ? `${Math.round(perMinute)} per min` : `${Math.round(perMinute * 60)} per hour`;
  }

  protected percent(t: { succeeded: number; total: number }): number {
    return t.total > 0 ? Math.round((t.succeeded / t.total) * 100) : 0;
  }
}
