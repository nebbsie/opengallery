import { ChangeDetectionStrategy, Component } from '@angular/core';
import { injectTrpc } from '@core/services/trpc';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { CacheKey } from '@core/services/cache-key.types';
import { DatePipe } from '@angular/common';
import { ErrorAlert } from '@core/components/error/error';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideRefreshCw } from '@ng-icons/lucide';

@Component({
  selector: 'app-settings-logs',
  imports: [ErrorAlert, HlmSpinner, DatePipe, HlmButton, HlmIcon, NgIcon],
  providers: [provideIcons({ lucideRefreshCw })],
  host: {
    class: 'flex flex-col w-full',
  },
  template: `
    <div class="mb-1 flex justify-between">
      <h1 class="text-foreground sticky mb-2 block text-lg font-bold">Logs</h1>

      <button class="text-foreground" (click)="refresh()" hlmBtn variant="ghost" size="icon">
        <ng-icon hlm size="sm" name="lucideRefreshCw" />
      </button>
    </div>

    @if (logsResult.isPending()) {
      <hlm-spinner />
    }

    @if (logsResult.isError()) {
      <app-error-alert [error]="logsResult.error()" />
    }

    @if (logsResult.isSuccess()) {
      <div
        class="flex max-h-[500px] flex-1 flex-col gap-1 overflow-scroll rounded border px-1 py-2 font-mono text-sm lg:max-h-[800px]"
      >
        @for (log of logsResult.data(); track log.id) {
          <div
            class="flex flex-col rounded px-1 py-0.5 text-xs transition-colors lg:flex-row lg:items-start lg:gap-1"
            [class.text-green-600]="log.type === 'info'"
            [class.text-yellow-600]="log.type === 'warn'"
            [class.text-red-600]="log.type === 'error'"
            [class.text-blue-600]="log.type === 'debug'"
          >
            <div class="flex shrink-0 items-center gap-1">
              <span class="text-gray-500">[{{ log.createdAt | date: 'dd-MM-yy HH:mm:ss' }}]</span>
              <span class="font-bold uppercase"> [{{ log.service }}] </span>
            </div>

            <p class="break-words lg:ml-2">
              {{ log.value.trim() }}
            </p>
          </div>
        }
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsLogs {
  private readonly trpc = injectTrpc();

  logsResult = injectQuery(() => ({
    queryKey: [CacheKey.Logs],
    queryFn: async () => this.trpc.log.get.query(),
  }));

  refresh(): void {
    this.logsResult.refetch();
  }
}
