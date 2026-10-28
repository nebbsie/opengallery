import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ErrorAlert } from '@core/components/error/error';
import { Loading } from '@core/components/loading/loading';
import { Confirm } from '@core/dialogs/confirm/confirm';
import { CacheKey } from '@core/services/cache-key.types';
import { ToastService } from '@core/services/toast/toast';
import { injectTrpc } from '@core/services/trpc';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCheckbox } from '@spartan-ng/helm/checkbox';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { formatBytes } from '../settings-duplicates/duplicate-sections';

const TRASH_KEY = [CacheKey.TrashAll];

type Failure = { name: string; reason: string };

// Settings > Trash: files and folders deleted in the UI. They sit in hidden
// ".trash" folders on the media drive until restored or deleted for good.
@Component({
  selector: 'app-settings-trash',
  imports: [Loading, ErrorAlert, HlmButton, HlmCheckbox, DatePipe],
  host: { class: 'flex flex-col w-full h-full overflow-hidden' },
  template: `
    <div class="flex shrink-0 flex-wrap items-start justify-between gap-x-4 gap-y-2 pb-3">
      <div class="min-w-0">
        <h1 class="text-foreground block text-lg font-bold">Trash</h1>
        <p class="text-muted-foreground text-sm text-pretty">
          Files and folders you deleted. They stay on the drive until you delete them forever.
          Restored files are imported again, so their faces and edits are not kept.
        </p>
      </div>
      @if (items().length > 0) {
        <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p class="text-muted-foreground text-sm tabular-nums">
            {{ items().length }} {{ items().length === 1 ? 'item' : 'items' }} ·
            {{ fmt(totalSize()) }}
          </p>
          <button
            hlmBtn
            variant="destructive"
            class="h-11 sm:h-9"
            [disabled]="busy()"
            (click)="emptyAll()"
          >
            Empty trash
          </button>
        </div>
      }
    </div>

    @if (trash.isPending()) {
      <app-loading />
    }

    @if (trash.isError()) {
      <app-error-alert [error]="trash.error()" />
    }

    @if (trash.isSuccess()) {
      @if (items().length === 0) {
        <div class="text-muted-foreground flex flex-col items-center gap-1 py-12 text-center">
          <p class="text-foreground font-medium">The trash is empty</p>
          <p class="text-sm text-pretty">Files you delete in the library show here.</p>
        </div>
      } @else {
        <!-- Selection bar: select all, and the actions on the selected items. -->
        <div
          class="bg-muted/40 mb-2 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-1.5"
        >
          <label class="flex min-h-11 cursor-pointer items-center gap-2 text-sm sm:min-h-9">
            <hlm-checkbox
              aria-label="Select all"
              [checked]="allChecked()"
              (checkedChange)="selectAll($event === true)"
            />
            @if (selected().size > 0) {
              <span class="tabular-nums">{{ selected().size }} selected · {{ fmt(selectedSize()) }}</span>
            } @else {
              <span class="text-muted-foreground">Select all</span>
            }
          </label>
          @if (selected().size > 0) {
            <div class="ml-auto flex gap-2">
              <button
                hlmBtn
                variant="outline"
                size="sm"
                class="h-11 sm:h-8"
                [disabled]="busy()"
                (click)="restoreSelected()"
              >
                Restore
              </button>
              <button
                hlmBtn
                variant="outline"
                size="sm"
                class="h-11 text-red-700 sm:h-8 dark:text-red-400"
                [disabled]="busy()"
                (click)="deleteSelected()"
              >
                Delete forever
              </button>
            </div>
          }
        </div>

        <ul class="min-h-0 flex-1 divide-y overflow-y-auto rounded-lg border">
          @for (it of items(); track it.id) {
            <li>
              <label
                class="hover:bg-muted/40 flex min-h-11 cursor-pointer items-start gap-3 p-3"
                [class.bg-muted/40]="selected().has(it.id)"
              >
                <hlm-checkbox
                  class="mt-0.5"
                  [aria-label]="'Select ' + it.name"
                  [checked]="selected().has(it.id)"
                  (checkedChange)="setSelected(it.id, $event === true)"
                />
                <div class="min-w-0 flex-1">
                  <p class="text-foreground truncate text-sm font-medium" [title]="it.name">
                    {{ it.name }}
                  </p>
                  <p class="text-muted-foreground truncate text-xs" [title]="it.originalPath">
                    {{ parentOf(it.originalPath) }}
                  </p>
                  <div class="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                    <span class="bg-muted rounded px-1.5 py-0.5">
                      {{ it.kind === 'folder' ? 'Folder' : 'File' }}
                    </span>
                    <span class="bg-muted rounded px-1.5 py-0.5 tabular-nums">{{ fmt(it.size) }}</span>
                    @if (it.kind === 'folder') {
                      <span class="bg-muted rounded px-1.5 py-0.5 tabular-nums">
                        {{ it.fileCount }} {{ it.fileCount === 1 ? 'file' : 'files' }}
                      </span>
                    }
                    <span class="text-muted-foreground tabular-nums">
                      Deleted {{ it.createdAt | date: 'medium' }}
                    </span>
                  </div>
                </div>
              </label>
            </li>
          }
        </ul>
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsTrash {
  private readonly trpc = injectTrpc();
  private readonly queryClient = inject(QueryClient);
  private readonly dialog = inject(HlmDialogService);
  private readonly toast = inject(ToastService);
  protected readonly fmt = formatBytes;

  trash = injectQuery(() => ({
    queryKey: TRASH_KEY,
    queryFn: () => this.trpc.trash.list.query(),
  }));

  protected readonly items = computed(() => this.trash.data() ?? []);
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  protected readonly totalSize = computed(() => this.items().reduce((n, i) => n + i.size, 0));
  protected readonly selectedSize = computed(() =>
    this.items()
      .filter((i) => this.selected().has(i.id))
      .reduce((n, i) => n + i.size, 0),
  );
  protected readonly allChecked = computed<boolean | 'indeterminate'>(() => {
    const n = this.selected().size;
    if (n === 0) return false;
    return n === this.items().length ? true : 'indeterminate';
  });

  restoreMutation = injectMutation(() => ({
    mutationFn: (ids: string[]) => this.trpc.trash.restore.mutate({ ids }),
    onSuccess: (res) => {
      if (res.restored > 0) {
        this.toast.success(
          `Restored ${res.restored} ${res.restored === 1 ? 'item' : 'items'}. They show in the library after the next scan.`,
        );
      }
      this.reportFailures('restore', res.failed);
    },
    onError: () => this.toast.error('Could not restore. Try again.'),
    onSettled: () => this.done(),
  }));

  emptyMutation = injectMutation(() => ({
    mutationFn: (ids: string[] | null) =>
      this.trpc.trash.empty.mutate(ids === null ? {} : { ids }),
    onSuccess: (res) => {
      if (res.removed > 0) {
        this.toast.success(
          `Deleted ${res.removed} ${res.removed === 1 ? 'item' : 'items'} forever, ${formatBytes(res.freed)} freed`,
        );
      }
      this.reportFailures('delete', res.failed);
    },
    onError: () => this.toast.error('Could not delete. Try again.'),
    onSettled: () => this.done(),
  }));

  protected readonly busy = computed(
    () => this.restoreMutation.isPending() || this.emptyMutation.isPending(),
  );

  protected parentOf(p: string): string {
    const i = p.lastIndexOf('/');
    return i > 0 ? p.slice(0, i) : p;
  }

  protected setSelected(id: string, on: boolean): void {
    const next = new Set(this.selected());
    if (on) next.add(id);
    else next.delete(id);
    this.selected.set(next);
  }

  protected selectAll(on: boolean): void {
    this.selected.set(on ? new Set(this.items().map((i) => i.id)) : new Set());
  }

  protected restoreSelected(): void {
    const ids = [...this.selected()];
    if (ids.length) this.restoreMutation.mutate(ids);
  }

  protected deleteSelected(): void {
    const ids = [...this.selected()];
    if (!ids.length) return;
    this.confirm(
      `Delete ${ids.length} ${ids.length === 1 ? 'item' : 'items'} (${formatBytes(this.selectedSize())}) forever? You cannot undo this.`,
      () => this.emptyMutation.mutate(ids),
    );
  }

  protected emptyAll(): void {
    const n = this.items().length;
    this.confirm(
      `Delete all ${n} ${n === 1 ? 'item' : 'items'} in the trash (${formatBytes(this.totalSize())}) forever? You cannot undo this.`,
      () => this.emptyMutation.mutate(null),
    );
  }

  private confirm(message: string, then: () => void): void {
    this.dialog
      .open(Confirm, { context: { type: 'danger', message } })
      .closed$.subscribe((ok: boolean) => {
        if (ok) then();
      });
  }

  private reportFailures(action: 'restore' | 'delete', failed: Failure[]): void {
    if (!failed.length) return;
    const first = failed[0]!;
    this.toast.error(
      failed.length === 1
        ? `Could not ${action} ${first.name}: ${first.reason}`
        : `Could not ${action} ${failed.length} items: ${first.reason}`,
      { duration: 12000 },
    );
  }

  private done(): void {
    this.selected.set(new Set());
    this.queryClient.invalidateQueries({ queryKey: TRASH_KEY });
    // Restored files come back into the library and the duplicate list.
    this.queryClient.invalidateQueries({ queryKey: [CacheKey.DuplicatesAll] });
  }
}
