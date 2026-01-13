import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { ErrorAlert } from '@core/components/error/error';
import { injectTrpc } from '@core/services/trpc';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { injectQuery } from '@tanstack/angular-query-experimental';

@Component({
  selector: 'app-settings-tasks',
  imports: [HlmSpinner, ErrorAlert],
  host: { class: 'flex flex-col w-full h-full' },
  template: `
    <div class="mb-3 flex items-center justify-between gap-4">
      <div>
        <h1 class="text-foreground block text-lg font-bold">Outstanding Encoding Tasks</h1>
        <p class="text-muted-foreground text-sm">
          Files currently queued or in progress (max 3 attempts).
        </p>
      </div>
      @if (tasks.isSuccess()) {
        <div class="text-muted-foreground text-sm">
          <span class="bg-muted rounded px-2 py-1 font-mono">{{ taskCount() }} tasks</span>
        </div>
      }
    </div>

    @if (tasks.isPending()) {
      <hlm-spinner />
    }

    @if (tasks.isError()) {
      <app-error-alert [error]="tasks.error()" />
    }

    @if (tasks.isSuccess()) {
      @if (tasks.data().length === 0) {
        <p class="text-muted-foreground">No outstanding tasks 🎉</p>
      } @else {
        <div class="flex-1 overflow-auto rounded border p-2">
          <div class="grid grid-cols-[1fr_auto] gap-2 font-mono text-sm">
            <div class="font-bold">File ID</div>
            <div class="text-right font-bold">Tasks</div>
            @for (item of tasks.data(); track item.fileId) {
              <div class="truncate" [title]="item.fileId">{{ item.fileId }}</div>
              <div class="text-right">
                @for (t of item.tasks; track t.type) {
                  @if (t.status === 'pending') {
                    <span
                      class="mr-1 inline-block rounded bg-yellow-100 px-1 text-yellow-800 dark:bg-yellow-900/30"
                    >
                      {{ t.type }}
                    </span>
                  }
                  @if (t.status === 'in_progress') {
                    <span
                      class="mr-1 inline-block rounded bg-blue-100 px-1 text-blue-800 dark:bg-blue-900/30"
                    >
                      {{ t.type }}
                    </span>
                  }
                  @if (t.status === 'succeeded') {
                    <span
                      class="mr-1 inline-block rounded bg-green-100 px-1 text-green-800 dark:bg-green-900/30"
                    >
                      {{ t.type }}
                    </span>
                  }
                  @if (t.status === 'failed') {
                    <span
                      class="mr-1 inline-block rounded bg-red-100 px-1 text-red-800 dark:bg-red-900/30"
                    >
                      {{ t.type }}
                    </span>
                  }
                }
              </div>
            }
          </div>
        </div>
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsTasks {
  private readonly trpc = injectTrpc();

  tasks = injectQuery(() => ({
    queryKey: ['fileTasks', 'outstanding'],
    queryFn: () => this.trpc.fileTask.listOutstanding.query(),
    refetchInterval: 5000,
  }));

  taskCount = computed(() => {
    const data = this.tasks.data();
    if (!data) return 0;
    return data.reduce((acc: number, item: { tasks: unknown[] }) => acc + item.tasks.length, 0);
  });
}
