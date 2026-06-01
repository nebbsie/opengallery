import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { SlicePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ErrorAlert } from '@core/components/error/error';
import { Loading } from '@core/components/loading/loading';
import { Confirm } from '@core/dialogs/confirm/confirm';
import { CacheKey } from '@core/services/cache-key.types';
import { optimisticEdit } from '@core/services/optimistic';
import { injectTrpc } from '@core/services/trpc';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

type DupeFile = {
  id: string;
  dir: string;
  name: string;
  size: number;
  type: string;
  contentHash: string | null;
  takenAt: string | null;
  createdAt: string;
};

type DupeGroup = {
  contentHash: string;
  files: DupeFile[];
};

@Component({
  selector: 'app-settings-duplicates',
  imports: [Loading, ErrorAlert, HlmButton, SlicePipe, RouterLink],
  host: { class: 'flex flex-col w-full h-full overflow-hidden' },
  template: `
    <div class="flex items-center justify-between gap-4 pb-3 shrink-0">
      <div>
        <h1 class="text-foreground block text-lg font-bold">Duplicate Files</h1>
        <p class="text-muted-foreground text-sm">
          Files with identical content. Delete copies to free up disk space.
        </p>
      </div>
      @if (duplicates.isSuccess() && duplicates.data().length > 0) {
        <div class="text-muted-foreground text-sm">
          {{ duplicates.data().length }} group(s) · {{ totalWasted() }} wasted
        </div>
      }
    </div>

    @if (duplicates.isPending()) {
      <app-loading />
    }

    @if (duplicates.isError()) {
      <app-error-alert [error]="duplicates.error()" />
    }

    @if (duplicates.isSuccess()) {
      @if (duplicates.data().length === 0) {
        <p class="text-muted-foreground">No duplicates found.</p>
      } @else {
        <div class="flex-1 overflow-y-auto space-y-4 min-h-0">
          @for (group of duplicates.data(); track group.contentHash) {
            <div class="rounded border p-3">
              <div class="text-muted-foreground mb-2 font-mono text-xs truncate" [title]="group.contentHash">
                {{ fmt(group.files[0]?.size ?? 0) }} · {{ group.files.length }} copies · {{ group.contentHash }}
              </div>
              <div class="space-y-1">
                @for (file of group.files; track file.id) {
                  <div class="grid grid-cols-[1fr_auto] gap-2 items-center font-mono text-sm">
                    <a
                      class="truncate text-foreground hover:underline cursor-pointer"
                      [title]="file.dir + '/' + file.name"
                      [routerLink]="['/asset', file.id]"
                      target="_blank"
                    >
                      {{ file.dir }}/{{ file.name }}
                    </a>
                    <div class="flex items-center gap-2 shrink-0">
                      @if (file.takenAt) {
                        <span class="text-muted-foreground text-xs">{{ file.takenAt | slice:0:10 }}</span>
                      }
                      @if (group.files.length > 1) {
                        <button
                          hlmBtn
                          variant="destructive"
                          size="sm"
                          (click)="deleteFile(file.id, file.dir + '/' + file.name)"
                          [disabled]="deleteMutation.isPending()"
                        >
                          Delete
                        </button>
                      }
                    </div>
                  </div>
                }
              </div>
            </div>
          }
        </div>
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsDuplicates {
  private readonly trpc = injectTrpc();
  private readonly queryClient = inject(QueryClient);
  private readonly dialog = inject(HlmDialogService);

  duplicates = injectQuery(() => ({
    queryKey: [CacheKey.DuplicatesAll],
    queryFn: () => this.trpc.duplicates.list.query(),
  }));

  protected fmt = formatBytes;

  totalWasted(): string {
    const groups = this.duplicates.data() ?? [];
    let bytes = 0;
    for (const g of groups) {
      if (g.files.length > 1) {
        bytes += g.files[0]!.size * (g.files.length - 1);
      }
    }
    return formatBytes(bytes);
  }

  deleteMutation = injectMutation(() => ({
    mutationFn: (fileId: string) => this.trpc.duplicates.deleteFile.mutate({ fileId }),
    onMutate: async (fileId: string) => {
      await this.queryClient.cancelQueries({ queryKey: [CacheKey.DuplicatesAll] });
      return optimisticEdit(this.queryClient, [
        {
          queryKey: [CacheKey.DuplicatesAll],
          update: (old: unknown) => {
            const groups = old as DupeGroup[] | undefined;
            if (!groups) return groups;
            return groups
              .map((g) => ({ ...g, files: g.files.filter((f) => f.id !== fileId) }))
              .filter((g) => g.files.length > 1);
          },
        },
      ]);
    },
    onError: (_err: unknown, _fileId: string, ctx: { rollback: () => void } | undefined) =>
      ctx?.rollback(),
    onSettled: () => {
      this.queryClient.invalidateQueries({ queryKey: [CacheKey.DuplicatesAll] });
    },
  }));

  deleteFile(fileId: string, filePath: string): void {
    this.dialog
      .open(Confirm, {
        context: {
          type: 'danger',
          message: `Permanently delete from disk: ${filePath}`,
        },
      })
      .closed$.subscribe((confirmed: boolean) => {
        if (confirmed) this.deleteMutation.mutate(fileId);
      });
  }
}
