import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ErrorAlert } from '@core/components/error/error';
import { injectTrpc } from '@core/services/trpc';
import { Loading } from '@core/components/loading/loading';
import { injectQuery } from '@tanstack/angular-query-experimental';

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
        <div class="text-muted-foreground text-right text-sm">
          <span class="bg-muted rounded px-2 py-1 font-mono">
            {{ tasks.data().totals.remaining }} remaining
          </span>
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
                <span class="text-muted-foreground text-sm">
                  {{ t.succeeded }} / {{ t.total }} done
                </span>
              </div>

              <div class="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                <div
                  class="h-full bg-green-500 transition-all duration-300"
                  [style.width.%]="percent(t)"
                ></div>
              </div>

              <div class="flex flex-wrap gap-2 text-xs">
                <span class="text-foreground font-medium">{{ t.remaining }} remaining</span>
                @if (t.pending > 0) {
                  <span class="rounded bg-yellow-100 px-1.5 py-0.5 text-yellow-800 dark:bg-yellow-900/30">
                    {{ t.pending }} waiting
                  </span>
                }
                @if (t.inProgress > 0) {
                  <span class="rounded bg-blue-100 px-1.5 py-0.5 text-blue-800 dark:bg-blue-900/30">
                    {{ t.inProgress }} in progress
                  </span>
                }
                @if (t.failed > 0) {
                  <span class="rounded bg-red-100 px-1.5 py-0.5 text-red-800 dark:bg-red-900/30">
                    {{ t.failed }} failed
                  </span>
                }
                @if (t.skipped > 0) {
                  <span class="bg-muted text-muted-foreground rounded px-1.5 py-0.5">
                    {{ t.skipped }} skipped
                  </span>
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

  tasks = injectQuery(() => ({
    queryKey: ['fileTasks', 'summary'],
    queryFn: () => this.trpc.fileTask.summary.query(),
    refetchInterval: 5000,
  }));

  protected label(type: string): string {
    return TASK_LABELS[type] ?? type;
  }

  protected percent(t: { succeeded: number; total: number }): number {
    return t.total > 0 ? Math.round((t.succeeded / t.total) * 100) : 0;
  }
}
