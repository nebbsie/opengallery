import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ErrorAlert } from '@core/components/error/error';
import { injectTrpc } from '@core/services/trpc';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronLeft, lucideChevronRight } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { injectQuery } from '@tanstack/angular-query-experimental';

@Component({
  selector: 'app-settings-tasks',
  imports: [HlmSpinner, ErrorAlert, HlmButton, HlmIcon, NgIcon],
  providers: [provideIcons({ lucideChevronLeft, lucideChevronRight })],
  host: { class: 'flex flex-col w-full h-full overflow-hidden' },
  template: `
    <div class="flex shrink-0 items-center justify-between gap-4 pb-3">
      <div>
        <h1 class="text-foreground block text-lg font-bold">Outstanding Encoding Tasks</h1>
        <p class="text-muted-foreground text-sm">
          Files currently queued or in progress (max 3 attempts).
        </p>
      </div>
      @if (tasks.isSuccess()) {
        <div class="text-muted-foreground text-sm">
          <span class="bg-muted rounded px-2 py-1 font-mono"
            >{{ tasks.data().totalFiles }} files</span
          >
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
      @if (tasks.data().items.length === 0) {
        <p class="text-muted-foreground">No outstanding tasks 🎉</p>
      } @else {
        <div class="min-h-0 flex-1 overflow-y-auto rounded border p-2">
          <div class="grid grid-cols-[1fr_auto] gap-2 font-mono text-sm">
            <div class="font-bold">File ID</div>
            <div class="text-right font-bold">Tasks</div>
            @for (item of tasks.data().items; track item.fileId) {
              <div class="truncate" [title]="item.fileId">{{ item.fileId }}</div>
              <div class="text-right">
                @for (t of item.tasks; track t.type) {
                  <span class="mr-4 inline-flex items-center gap-1">
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
                      @if (t.progress != null && t.progress > 0) {
                        <div class="inline-flex w-24 items-center gap-1 align-middle">
                          <div class="h-2.5 flex-1 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                            <div
                              class="h-full bg-blue-500 transition-all duration-300"
                              [style.width.%]="t.progress"
                            ></div>
                          </div>
                          <span class="text-xs text-gray-500">{{ t.progress }}%</span>
                        </div>
                      } @else {
                        <span class="text-xs text-gray-400">processing...</span>
                      }
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
                  </span>
                }
              </div>
            }
          </div>
        </div>

        <div class="flex shrink-0 items-center justify-between pt-3">
          <span class="text-muted-foreground text-sm">
            Page {{ page() }} of {{ tasks.data().totalPages }}
          </span>
          <div class="flex gap-2">
            <button
              hlmBtn
              variant="outline"
              size="sm"
              [disabled]="page() <= 1"
              (click)="prevPage()"
            >
              <ng-icon hlm size="sm" name="lucideChevronLeft" />
              Previous
            </button>
            <button
              hlmBtn
              variant="outline"
              size="sm"
              [disabled]="page() >= tasks.data().totalPages"
              (click)="nextPage()"
            >
              Next
              <ng-icon hlm size="sm" name="lucideChevronRight" />
            </button>
          </div>
        </div>
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsTasks {
  private readonly trpc = injectTrpc();

  page = signal(1);
  pageSize = signal(50);

  tasks = injectQuery(() => ({
    queryKey: ['fileTasks', 'outstanding', this.page(), this.pageSize()],
    queryFn: () =>
      this.trpc.fileTask.listOutstanding.query({
        page: this.page(),
        pageSize: this.pageSize(),
      }),
    refetchInterval: 5000,
  }));

  prevPage(): void {
    if (this.page() > 1) {
      this.page.update((p) => p - 1);
    }
  }

  nextPage(): void {
    const data = this.tasks.data();
    if (data && this.page() < data.totalPages) {
      this.page.update((p) => p + 1);
    }
  }
}
