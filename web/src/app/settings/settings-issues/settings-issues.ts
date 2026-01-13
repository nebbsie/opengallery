import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ErrorAlert } from '@core/components/error/error';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { HlmButton } from '@spartan-ng/helm/button';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';

@Component({
  selector: 'app-settings-issues',
  imports: [HlmSpinner, ErrorAlert, HlmButton],
  host: { class: 'flex flex-col w-full h-full' },
  template: `
    <div class="mb-3 flex items-center justify-between gap-4">
      <div>
        <h1 class="text-foreground block text-lg font-bold">Import/Encoding Issues</h1>
        <p class="text-muted-foreground text-sm">
          Files that failed during import or encoding. You can retry processing them.
        </p>
      </div>
      @if (issues.isSuccess() && issues.data().length > 0) {
        <div>
          <button
            hlmBtn
            (click)="retryAll()"
            [disabled]="retryAllMutation.isPending()"
          >
            Retry All
          </button>
        </div>
      }
    </div>

    @if (issues.isPending()) {
      <hlm-spinner />
    }

    @if (issues.isError()) {
      <app-error-alert [error]="issues.error()" />
    }

    @if (issues.isSuccess()) {
      @if (issues.data().length === 0) {
        <p class="text-muted-foreground">No issues found.</p>
      } @else {
        <div class="flex-1 overflow-auto rounded border p-2">
          <div class="grid grid-cols-[1fr_auto_auto] gap-2 font-mono text-sm">
            <div class="font-bold">File ID</div>
            <div class="text-right font-bold">Attempts</div>
            <div></div>
            @for (it of issues.data(); track it.fileId) {
              <div class="truncate" [title]="it.fileId">{{ it.fileId }}</div>
              <div class="text-right">
                <span class="bg-red-100 px-2 py-1 text-red-800 dark:bg-red-900/30 rounded">
                  {{ it.attempts }} attempts
                </span>
              </div>
              <div class="text-right">
                <button
                  hlmBtn
                  variant="outline"
                  size="sm"
                  (click)="retry(it.fileId)"
                  [disabled]="retryMutation.isPending()"
                >
                  Retry
                </button>
              </div>
            }
          </div>
        </div>
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsIssues {
  private readonly trpc = injectTrpc();
  private readonly queryClient = inject(QueryClient);

  issues = injectQuery(() => ({
    queryKey: [CacheKey.Logs, 'issues'],
    queryFn: async () => this.trpc.issues.list.query(),
  }));

  retryMutation = injectMutation(() => ({
    mutationFn: (fileId: string) => this.trpc.issues.retry.mutate({ fileId }),
    onSuccess: () => {
      this.queryClient.invalidateQueries({ queryKey: [CacheKey.Logs, 'issues'] });
    },
  }));

  retryAllMutation = injectMutation(() => ({
    mutationFn: () => this.trpc.issues.retryAll.mutate(),
    onSuccess: () => {
      this.queryClient.invalidateQueries({ queryKey: [CacheKey.Logs, 'issues'] });
    },
  }));

  retry(fileId: string) {
    this.retryMutation.mutate(fileId);
  }

  retryAll() {
    this.retryAllMutation.mutate();
  }
}
