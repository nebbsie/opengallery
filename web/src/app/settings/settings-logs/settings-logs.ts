import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { ErrorAlert } from '@core/components/error/error';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideBug,
  lucideCircleAlert,
  lucideInfo,
  lucideRefreshCw,
  lucideTriangleAlert,
} from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { injectQuery } from '@tanstack/angular-query-experimental';

@Component({
  selector: 'app-settings-logs',
  imports: [ErrorAlert, HlmSpinner, DatePipe, HlmButton, HlmIcon, NgIcon],
  providers: [
    provideIcons({
      lucideRefreshCw,
      lucideInfo,
      lucideTriangleAlert,
      lucideCircleAlert,
      lucideBug,
    }),
  ],
  host: {
    class: 'flex flex-col w-full h-full',
  },
  template: `
    <div class="mb-3 flex items-center justify-between gap-4">
      <div>
        <h1 class="text-foreground block text-lg font-bold">Logs</h1>
        <p class="text-muted-foreground text-sm">
          View application logs and events.
        </p>
      </div>

      <div class="flex gap-2">
        <button
          hlmBtn
          variant="ghost"
          size="icon"
          (click)="toggleInfo()"
          [class]="
            showInfo()
              ? 'text-green-600 hover:bg-transparent hover:text-green-600'
              : 'text-muted-foreground hover:text-muted-foreground hover:bg-transparent'
          "
        >
          <ng-icon hlm size="sm" name="lucideInfo" />
        </button>

        <button
          hlmBtn
          variant="ghost"
          size="icon"
          (click)="toggleWarn()"
          [class]="
            showWarn()
              ? 'text-yellow-600 hover:bg-transparent hover:text-yellow-600'
              : 'text-muted-foreground hover:text-muted-foreground hover:bg-transparent'
          "
        >
          <ng-icon hlm size="sm" name="lucideTriangleAlert" />
        </button>

        <button
          hlmBtn
          variant="ghost"
          size="icon"
          (click)="toggleError()"
          [class]="
            showError()
              ? 'text-red-600 hover:bg-transparent hover:text-red-600'
              : 'text-muted-foreground hover:text-muted-foreground hover:bg-transparent'
          "
        >
          <ng-icon hlm size="sm" name="lucideCircleAlert" />
        </button>

        <button
          hlmBtn
          variant="ghost"
          size="icon"
          (click)="toggleDebug()"
          [class]="
            showDebug()
              ? 'text-sky-600 hover:bg-transparent hover:text-sky-600'
              : 'text-muted-foreground hover:text-muted-foreground hover:bg-transparent'
          "
        >
          <ng-icon hlm size="sm" name="lucideBug" />
        </button>

        <button class="text-foreground" (click)="refresh()" hlmBtn variant="ghost" size="icon">
          <ng-icon hlm size="sm" name="lucideRefreshCw" />
        </button>
      </div>
    </div>

    @if (logsResult.isPending()) {
      <hlm-spinner />
    }

    @if (logsResult.isError() && logsResult.error(); as error) {
      <app-error-alert [error]="error" />
    }

    @if (logsResult.isSuccess()) {
      <div
        class="flex flex-1 flex-col gap-1 overflow-auto rounded border px-1 py-2 font-mono text-sm"
      >
        @for (log of logsResult.data(); track log.id) {
          <div
            class="flex flex-col rounded px-1 py-0.5 text-xs transition-colors lg:flex-row lg:items-start lg:gap-1"
            [class.text-green-600]="log.type === 'info'"
            [class.text-yellow-600]="log.type === 'warn'"
            [class.text-red-600]="log.type === 'error'"
            [class.text-sky-600]="log.type === 'debug'"
          >
            <div class="flex shrink-0 items-center gap-1 text-xs">
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

  showInfo = signal(true);
  showWarn = signal(true);
  showError = signal(true);
  showDebug = signal(true);

  selectedTypes = computed(() => {
    const out: ('info' | 'warn' | 'error' | 'debug')[] = [];
    if (this.showInfo()) out.push('info');
    if (this.showWarn()) out.push('warn');
    if (this.showError()) out.push('error');
    if (this.showDebug()) out.push('debug');
    return out;
  });

  selectedTypesKey = computed(() => this.selectedTypes().join(','));

  logsResult = injectQuery(() => ({
    queryKey: [CacheKey.Logs, this.selectedTypesKey()],
    queryFn: async () => {
      const types = this.selectedTypes();
      if (!types.length) return [];
      return this.trpc.log.get.query({ types, limit: 200 });
    },
    refetchInterval: 5_000,
  }));

  toggleInfo(): void {
    this.showInfo.update((v) => !v);
  }

  toggleWarn(): void {
    this.showWarn.update((v) => !v);
  }

  toggleError(): void {
    this.showError.update((v) => !v);
  }

  toggleDebug(): void {
    this.showDebug.update((v) => !v);
  }

  refresh(): void {
    this.logsResult.refetch();
  }
}
