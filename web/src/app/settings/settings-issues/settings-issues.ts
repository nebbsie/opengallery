import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ErrorAlert } from '@core/components/error/error';
import { CacheKey } from '@core/services/cache-key.types';
import { optimisticEdit } from '@core/services/optimistic';
import { ToastService } from '@core/services/toast/toast';
import { injectTrpc } from '@core/services/trpc';
import { Loading } from '@core/components/loading/loading';
import { HlmButton } from '@spartan-ng/helm/button';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';

const ISSUES_KEY = [CacheKey.Logs, 'issues'];

const TASK_LABELS: Record<string, string> = {
  encode_thumbnail: 'Thumbnail',
  encode_optimised: 'Optimised',
  video_poster: 'Video poster',
};

@Component({
  selector: 'app-settings-issues',
  imports: [Loading, ErrorAlert, HlmButton],
  host: { class: 'flex flex-col w-full h-full overflow-hidden' },
  template: `
    <div class="flex shrink-0 flex-wrap items-start justify-between gap-x-4 gap-y-2 pb-3">
      <div class="min-w-0">
        <h1 class="text-foreground block text-lg font-bold">Import/Encoding Issues</h1>
        <p class="text-muted-foreground text-sm text-pretty">
          Files that failed during import or encoding. Retry them, or delete files that are broken.
        </p>
      </div>
      @if (issues.isSuccess() && issues.data().length > 0) {
        <div class="flex gap-2">
          @if (confirmAll()) {
            <button
              hlmBtn
              variant="destructive"
              class="h-11 sm:h-9"
              [disabled]="removeMutation.isPending()"
              (click)="removeAll()"
            >
              Delete {{ issues.data().length }} {{ issues.data().length === 1 ? 'file' : 'files' }}
            </button>
            <button hlmBtn variant="ghost" class="h-11 sm:h-9" (click)="confirmAll.set(false)">
              Cancel
            </button>
          } @else {
            <button
              hlmBtn
              variant="outline"
              class="h-11 sm:h-9"
              [disabled]="removeMutation.isPending()"
              (click)="confirmAll.set(true)"
            >
              Delete all
            </button>
            <button
              hlmBtn
              class="h-11 sm:h-9"
              (click)="retryAll()"
              [disabled]="retryAllMutation.isPending()"
            >
              Retry all
            </button>
          }
        </div>
      }
    </div>

    @if (issues.isPending()) {
      <app-loading />
    }

    @if (issues.isError()) {
      <app-error-alert [error]="issues.error()" />
    }

    @if (issues.isSuccess()) {
      @if (issues.data().length === 0) {
        <p class="text-muted-foreground">No issues found.</p>
      } @else {
        <ul class="min-h-0 flex-1 divide-y overflow-y-auto rounded-lg border">
          @for (it of issues.data(); track it.fileId) {
            <li class="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:gap-4">
              <div class="min-w-0 flex-1">
                <p class="text-foreground truncate text-sm font-medium" [title]="it.name">
                  {{ it.name }}
                </p>
                <p class="text-muted-foreground truncate text-xs" [title]="it.dir">{{ it.dir }}</p>
                <div class="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                  <span class="bg-muted rounded px-1.5 py-0.5 capitalize">{{ it.type }}</span>
                  <span class="bg-muted rounded px-1.5 py-0.5 tabular-nums">
                    {{ formatSize(it.size) }}
                  </span>
                  @for (t of it.tasks; track t) {
                    <span class="bg-muted rounded px-1.5 py-0.5">{{ taskLabel(t) }}</span>
                  }
                  @if (it.attempts > 0) {
                    <span
                      class="rounded bg-red-500/15 px-1.5 py-0.5 text-red-700 tabular-nums dark:text-red-400"
                    >
                      {{ it.attempts }} {{ it.attempts === 1 ? 'attempt' : 'attempts' }}
                    </span>
                  } @else {
                    <span
                      class="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-700 dark:text-amber-400"
                    >
                      Skipped
                    </span>
                  }
                </div>
                @if (it.size === 0) {
                  <p class="mt-1.5 text-xs text-red-700 dark:text-red-400">
                    The file is empty (0 bytes).
                  </p>
                } @else if (it.error) {
                  <p class="mt-1.5 text-xs text-red-700 dark:text-red-400">{{ it.error }}</p>
                }
                @if (it.errorDetail) {
                  <details class="mt-1 text-xs">
                    <summary
                      class="text-muted-foreground hover:text-foreground cursor-pointer select-none"
                    >
                      Details
                    </summary>
                    <pre
                      class="bg-muted/60 text-muted-foreground mt-1 overflow-x-auto rounded p-2 font-mono text-[11px] break-all whitespace-pre-wrap"
                      >{{ it.errorDetail }}</pre
                    >
                  </details>
                }
              </div>
              <div class="flex shrink-0 gap-2">
                @if (confirmId() === it.fileId) {
                  <button
                    hlmBtn
                    variant="destructive"
                    size="sm"
                    class="h-11 sm:h-8"
                    [disabled]="removeMutation.isPending()"
                    (click)="remove([it.fileId])"
                  >
                    Delete
                  </button>
                  <button
                    hlmBtn
                    variant="ghost"
                    size="sm"
                    class="h-11 sm:h-8"
                    (click)="confirmId.set(null)"
                  >
                    Cancel
                  </button>
                } @else {
                  <button
                    hlmBtn
                    variant="outline"
                    size="sm"
                    class="h-11 sm:h-8"
                    (click)="retry(it.fileId)"
                    [disabled]="retryMutation.isPending()"
                  >
                    Retry
                  </button>
                  <button
                    hlmBtn
                    variant="outline"
                    size="sm"
                    class="h-11 text-red-700 sm:h-8 dark:text-red-400"
                    [disabled]="removeMutation.isPending()"
                    (click)="confirmId.set(it.fileId)"
                  >
                    Delete
                  </button>
                }
              </div>
            </li>
          }
        </ul>
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsIssues {
  private readonly trpc = injectTrpc();
  private readonly queryClient = inject(QueryClient);
  private readonly toast = inject(ToastService);

  // The row that shows "Delete / Cancel", and the header "Delete all" step.
  protected readonly confirmId = signal<string | null>(null);
  protected readonly confirmAll = signal(false);

  issues = injectQuery(() => ({
    queryKey: ISSUES_KEY,
    queryFn: async () => this.trpc.issues.list.query(),
  }));

  // Optimistic: the retried issue(s) leave the list immediately (they're now
  // re-queued), and are restored if the retry call fails.
  retryMutation = injectMutation(() => ({
    mutationFn: (fileId: string) => this.trpc.issues.retry.mutate({ fileId }),
    onMutate: async (fileId) => this.dropFromList([fileId]),
    onError: (_err, _fileId, ctx) => ctx?.rollback(),
    onSettled: () => this.queryClient.invalidateQueries({ queryKey: ISSUES_KEY }),
  }));

  retryAllMutation = injectMutation(() => ({
    mutationFn: () => this.trpc.issues.retryAll.mutate(),
    onMutate: async () => {
      await this.queryClient.cancelQueries({ queryKey: ISSUES_KEY });
      return optimisticEdit(this.queryClient, [{ queryKey: ISSUES_KEY, update: () => [] }]);
    },
    onError: (_err, _vars, ctx) => ctx?.rollback(),
    onSettled: () => this.queryClient.invalidateQueries({ queryKey: ISSUES_KEY }),
  }));

  // Deleted files leave the list at once and come back if the call fails.
  removeMutation = injectMutation(() => ({
    mutationFn: (fileIds: string[]) => this.trpc.issues.remove.mutate({ fileIds }),
    onMutate: async (fileIds) => this.dropFromList(fileIds),
    onSuccess: (res) => {
      // Files that could not move to the trash stay in the library (and come
      // back into the list on the refetch), with the reason.
      if (res.failed.length > 0) {
        const first = res.failed[0]!;
        this.toast.error(
          res.failed.length === 1
            ? `Could not delete ${first.name}: ${first.reason}`
            : `Could not delete ${res.failed.length} files: ${first.reason}`,
          { duration: 12000 },
        );
      }
      if (res.deleted > 0) {
        this.toast.success(`Moved ${res.deleted} ${res.deleted === 1 ? 'file' : 'files'} to the trash`);
      }
    },
    onError: (_err, _ids, ctx) => {
      ctx?.rollback();
      this.toast.error('Could not delete. Try again.');
    },
    onSettled: () => {
      this.confirmId.set(null);
      this.confirmAll.set(false);
      this.queryClient.invalidateQueries({ queryKey: ISSUES_KEY });
      this.queryClient.invalidateQueries({ queryKey: [CacheKey.Logs] });
    },
  }));

  private async dropFromList(fileIds: string[]) {
    await this.queryClient.cancelQueries({ queryKey: ISSUES_KEY });
    const drop = new Set(fileIds);
    return optimisticEdit(this.queryClient, [
      {
        queryKey: ISSUES_KEY,
        update: (old) =>
          (old as { fileId: string }[] | undefined)?.filter((i) => !drop.has(i.fileId)),
      },
    ]);
  }

  protected taskLabel(task: string): string {
    return TASK_LABELS[task] ?? task;
  }

  protected formatSize(bytes: number | null): string {
    if (bytes == null) return 'Unknown size';
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let v = bytes / 1024;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
  }

  retry(fileId: string) {
    this.retryMutation.mutate(fileId);
  }

  retryAll() {
    this.retryAllMutation.mutate();
  }

  remove(fileIds: string[]) {
    this.removeMutation.mutate(fileIds);
  }

  removeAll() {
    const ids = (this.issues.data() ?? []).map((i) => i.fileId);
    for (let i = 0; i < ids.length; i += 200) this.remove(ids.slice(i, i + 200));
  }
}
