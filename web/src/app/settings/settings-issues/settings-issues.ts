import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ErrorAlert } from '@core/components/error/error';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';

@Component({
  selector: 'app-settings-issues',
  imports: [HlmSpinner, ErrorAlert, HlmButton],
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
      @if (!issues.data().length) {
        <p class="text-muted-foreground">No issues found.</p>
      } @else {
        <div class="space-y-2">
          @for (item of issues.data(); track item.id) {
            <div class="flex items-center justify-between rounded-lg border p-3">
              <div class="min-w-0">
                <p class="truncate text-sm">
                  <span class="font-medium">{{ item.file.name }}</span>
                  <span class="text-muted-foreground"> — {{ item.stage }}</span>
                </p>
                <p class="text-muted-foreground text-sm">{{ item.message }}</p>
              </div>
              <div class="flex items-center gap-2">
                <button hlmBtn variant="outline" size="sm" (click)="retry(item.fileId)">
                  Retry
                </button>
              </div>
            </div>
          }
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
