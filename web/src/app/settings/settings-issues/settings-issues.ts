import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ErrorAlert } from '@core/components/error/error';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';

@Component({
  selector: 'app-settings-issues',
  imports: [HlmSpinner, ErrorAlert],
  host: { class: 'w-full' },
  template: `
    <h1 class="text-foreground mb-2 block text-lg font-bold">Import/Encoding Issues</h1>
    <p class="text-muted-foreground mb-6 text-sm">
      Files that failed during import or encoding. You can retry processing them.
    </p>

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
        <div class="rounded border p-2">
          <div class="grid grid-cols-[1fr_auto] gap-2 font-mono text-sm">
            <div class="font-bold">File ID</div>
            <div class="text-right font-bold">Attempts</div>
            @for (it of issues.data(); track it.fileId) {
              <div class="truncate">{{ it.fileId }}</div>
              <div class="text-right">{{ it.attempts }}</div>
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

  retry(fileId: string) {
    this.retryMutation.mutate(fileId);
  }
}
