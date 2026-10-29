import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { Confirm } from '@core/dialogs/confirm/confirm';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { PluralPipe } from '@core/pipes/plural.pipe';
import { Auth } from '@core/services/auth/auth';
import { GridSelection } from '@core/services/selection/grid-selection';
import { ToastService } from '@core/services/toast/toast';
import { injectTrpc } from '@core/services/trpc';
import { environment } from '@env/environment';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideDownload,
  lucideEyeOff,
  lucideImage,
  lucideRotateCw,
  lucideShare2,
  lucideTrash2,
  lucideX,
} from '@ng-icons/lucide';
import { RotationService } from '@core/services/rotation/rotation';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { BulkPeopleDialog, BulkPeopleDialogContext } from './bulk-people-dialog';

/**
 * Bottom action bar for a grid selection. Put it once in a page that provides
 * `GridSelection`. On phones it covers the bottom nav while items are
 * selected (like Google Photos); on wider screens it floats above the grid.
 */
@Component({
  selector: 'app-selection-bar',
  imports: [NgIcon, HlmIcon, HlmSpinner, PluralPipe],
  providers: [
    provideIcons({
      lucideDownload,
      lucideEyeOff,
      lucideImage,
      lucideRotateCw,
      lucideShare2,
      lucideTrash2,
      lucideX,
    }),
  ],
  host: { class: 'contents' },
  template: `
    <div
      class="glass-strong text-popover-foreground fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+0.5rem)] z-50 flex min-h-[3.5rem] items-center gap-1 rounded-[1.75rem] px-1 transition-[translate,opacity] duration-200 ease-out sm:inset-x-auto sm:bottom-5 sm:left-1/2 sm:-translate-x-1/2 sm:rounded-full sm:pr-3 sm:pl-2"
      [class]="
        visible()
          ? 'translate-y-0 opacity-100'
          : 'pointer-events-none translate-y-[calc(100%+1rem)] opacity-0'
      "
      role="toolbar"
      aria-label="Selection actions"
      [attr.aria-hidden]="!visible()"
      [attr.inert]="visible() ? null : ''"
    >
      <button
        type="button"
        class="hover:bg-glass-tint-strong grid size-10 shrink-0 place-items-center rounded-full transition-[background-color,scale] duration-150 active:scale-[0.96]"
        aria-label="Clear selection"
        title="Clear selection (Esc)"
        (click)="selection.clear()"
      >
        <ng-icon hlm size="sm" name="lucideX" />
      </button>
      <span
        class="mr-auto min-w-0 truncate pr-2 text-sm font-semibold tabular-nums sm:mr-3"
        aria-live="polite"
      >
        {{ shownCount() | plural: 'item' }} selected
      </span>

      <button
        type="button"
        class="hover:bg-glass-tint-strong flex h-10 shrink-0 items-center gap-2 rounded-full px-3 text-sm font-medium transition-[background-color,scale] duration-150 active:scale-[0.96] disabled:opacity-50"
        [disabled]="downloading()"
        (click)="download()"
      >
        @if (downloading()) {
          <hlm-spinner class="size-4" />
        } @else {
          <ng-icon hlm size="sm" name="lucideDownload" />
        }
        <span class="hidden sm:inline">Download</span>
        <span class="sr-only sm:hidden">Download</span>
      </button>
      <button
        type="button"
        class="hover:bg-glass-tint-strong flex h-10 shrink-0 items-center gap-2 rounded-full px-3 text-sm font-medium transition-[background-color,scale] duration-150 active:scale-[0.96]"
        (click)="openPeople('share')"
      >
        <ng-icon hlm size="sm" name="lucideShare2" />
        <span class="hidden sm:inline">Share</span>
        <span class="sr-only sm:hidden">Share</span>
      </button>
      @if (isAdmin()) {
        <button
          type="button"
          class="hover:bg-glass-tint-strong flex h-10 shrink-0 items-center gap-2 rounded-full px-3 text-sm font-medium transition-[background-color,scale] duration-150 active:scale-[0.96]"
          (click)="openPeople('hide')"
        >
          <ng-icon hlm size="sm" name="lucideEyeOff" />
          <span class="hidden sm:inline">Hide from</span>
          <span class="sr-only sm:hidden">Hide from</span>
        </button>
        @if (albumId() && selection.count() === 1) {
          <button
            type="button"
            class="hover:bg-glass-tint-strong flex h-10 shrink-0 items-center gap-2 rounded-full px-3 text-sm font-medium transition-[background-color,scale] duration-150 active:scale-[0.96]"
            (click)="setCover()"
          >
            <ng-icon hlm size="sm" name="lucideImage" />
            <span class="hidden sm:inline">Set as cover</span>
            <span class="sr-only sm:hidden">Set as cover</span>
          </button>
        }
        <button
          type="button"
          class="hover:bg-glass-tint-strong flex h-10 shrink-0 items-center gap-2 rounded-full px-3 text-sm font-medium transition-[background-color,scale] duration-150 active:scale-[0.96] disabled:opacity-50"
          [disabled]="rotating()"
          (click)="rotateSelected()"
        >
          <ng-icon hlm size="sm" name="lucideRotateCw" />
          <span class="hidden sm:inline">Rotate</span>
          <span class="sr-only sm:hidden">Rotate</span>
        </button>
      }
      @if (isAdmin() || allowDelete()) {
        <button
          type="button"
          class="flex h-10 shrink-0 items-center gap-2 rounded-full px-3 text-sm font-medium text-red-700 transition-[background-color,scale] duration-150 hover:bg-red-500/15 active:scale-[0.96] disabled:opacity-50 dark:text-red-400"
          [disabled]="deleting()"
          (click)="confirmDelete()"
        >
          @if (deleting()) {
            <hlm-spinner class="size-4" />
          } @else {
            <ng-icon hlm size="sm" name="lucideTrash2" />
          }
          <span class="hidden sm:inline">Delete</span>
          <span class="sr-only sm:hidden">Delete</span>
        </button>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SelectionBar {
  protected readonly selection = inject(GridSelection);
  private readonly trpc = injectTrpc();
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(HlmDialogService);
  protected readonly isAdmin = inject(Auth).isAdmin;
  private readonly apiUrl = environment.api.url;

  private readonly queryClient = inject(QueryClient);
  // Set on an album page: enables "Set as cover" for one selected item.
  readonly albumId = input<string | null>(null);
  // Show Delete to a non-admin (a collaborator on this album). The server
  // still deletes only the files they uploaded.
  readonly allowDelete = input(false);

  protected readonly visible = computed(() => this.selection.active());
  protected readonly downloading = signal(false);
  protected readonly deleting = signal(false);
  protected readonly rotating = signal(false);
  private readonly rotation = inject(RotationService);

  // Keep the last count while the bar slides away, so it never reads "0 items".
  private readonly lastCount = signal(0);
  protected readonly shownCount = computed(() => this.selection.count() || this.lastCount());

  constructor() {
    effect(() => {
      const n = this.selection.count();
      if (n > 0) this.lastCount.set(n);
    });
  }

  protected async download(): Promise<void> {
    const ids = [...this.selection.ids()];
    if (!ids.length || this.downloading()) return;

    if (ids.length === 1) {
      this.startDownload(`${this.apiUrl}/asset/${encodeURIComponent(ids[0])}?download=1`);
      this.toast.show('Download started');
      return;
    }

    this.downloading.set(true);
    try {
      const { token, count } = await this.trpc.files.createDownload.mutate({ fileIds: ids });
      this.startDownload(`${this.apiUrl}/download/${encodeURIComponent(token)}`);
      this.toast.success(
        `Zipping ${count.toLocaleString()} ${count === 1 ? 'item' : 'items'}. The download starts soon.`,
      );
    } catch (err) {
      this.toast.error((err as Error)?.message || 'Could not start the download. Try again.');
    } finally {
      this.downloading.set(false);
    }
  }

  private startDownload(url: string): void {
    // An attachment response does not leave the page.
    const a = document.createElement('a');
    a.href = url;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  protected openPeople(mode: BulkPeopleDialogContext['mode']): void {
    const fileIds = [...this.selection.ids()];
    if (!fileIds.length) return;
    const ref = this.dialog.open(BulkPeopleDialog, {
      context: { mode, fileIds } satisfies BulkPeopleDialogContext,
      contentClass: 'sm:max-w-md',
    });
    ref.closed$.subscribe((done) => {
      if (done) this.selection.clear();
    });
  }

  // Turn the selected photos a quarter clockwise (videos are left as they are).
  protected async rotateSelected(): Promise<void> {
    const fileIds = [...this.selection.ids()];
    if (!fileIds.length || this.rotating()) return;
    this.rotating.set(true);
    try {
      const res = await this.rotation.rotate(fileIds, 90);
      if (res.rotated) {
        this.toast.success(`Rotating ${res.rotated.toLocaleString()} ${res.rotated === 1 ? 'photo' : 'photos'}`);
      }
      if (res.failed.length) {
        this.toast.error(
          res.failed.length === 1
            ? `Could not rotate ${res.failed[0]!.name}: ${res.failed[0]!.reason}`
            : `Could not rotate ${res.failed.length} items: ${res.failed[0]!.reason}`,
        );
      }
    } catch (err) {
      this.toast.error((err as Error)?.message || 'Could not rotate. Try again.');
    } finally {
      this.rotating.set(false);
    }
  }

  protected async setCover(): Promise<void> {
    const albumId = this.albumId();
    const [fileId] = [...this.selection.ids()];
    if (!albumId || !fileId) return;
    try {
      await this.trpc.edit.setAlbumCover.mutate({ albumId, fileId });
      this.toast.success('Album cover set');
      this.selection.clear();
      await this.queryClient.invalidateQueries();
    } catch (err) {
      this.toast.error((err as Error)?.message || 'Could not set the cover. Try again.');
    }
  }

  // Move the selected originals to the trash (admin). They leave every view.
  protected confirmDelete(): void {
    const fileIds = [...this.selection.ids()];
    if (!fileIds.length) return;
    const what =
      fileIds.length === 1 ? 'this item' : `these ${fileIds.length.toLocaleString()} items`;
    this.dialog
      .open(Confirm, {
        context: {
          type: 'danger',
          message:
            `Delete ${what}? The files move to the trash on the drive, with their RAW files, ` +
            'and you can restore them from Settings, Trash.',
        },
      })
      .closed$.subscribe(async (confirmed: boolean) => {
        if (!confirmed) return;
        this.deleting.set(true);
        try {
          let deleted = 0;
          const failed: { name: string; reason: string }[] = [];
          for (let i = 0; i < fileIds.length; i += 1000) {
            const res = await this.trpc.edit.deleteFiles.mutate({
              fileIds: fileIds.slice(i, i + 1000),
            });
            deleted += res.deleted;
            failed.push(...res.failed);
          }
          if (deleted)
            this.toast.success(
              `Moved ${deleted.toLocaleString()} ${deleted === 1 ? 'item' : 'items'} to the trash`,
            );
          if (failed.length) {
            this.toast.error(
              failed.length === 1
                ? `Could not delete ${failed[0]!.name}: ${failed[0]!.reason}`
                : `Could not delete ${failed.length} items: ${failed[0]!.reason}`,
              { duration: 12000 },
            );
          }
          this.selection.clear();
          await this.queryClient.invalidateQueries();
        } catch (err) {
          this.toast.error((err as Error)?.message || 'Could not delete. Try again.');
        } finally {
          this.deleting.set(false);
        }
      });
  }
}
