import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ErrorAlert } from '@core/components/error/error';
import { PluralPipe } from '@core/pipes/plural.pipe';
import { ToastService } from '@core/services/toast/toast';
import { environment } from '@env/environment';
import { Confirm } from '@core/dialogs/confirm/confirm';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';

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
  width?: number | null;
  height?: number | null;
  // RAW companion of a RAW+JPEG pair; kept on disk, shown as its own photo.
  rawName?: string | null;
};

type DupeGroup = {
  contentHash: string;
  files: DupeFile[];
};

@Component({
  selector: 'app-settings-duplicates',
  imports: [ErrorAlert, HlmButton, DatePipe, RouterLink, PluralPipe],
  host: { class: 'flex flex-col w-full h-full overflow-hidden' },
  template: `
    <div class="flex shrink-0 flex-wrap items-end justify-between gap-x-4 gap-y-1 pb-3">
      <div>
        <h1 class="text-foreground block text-lg font-bold">Duplicate files</h1>
        <p class="text-muted-foreground text-sm text-pretty">
          These files have the same content. Choose the copy to keep, and the other copies are
          deleted from disk.
        </p>
      </div>
      @if (duplicates.isSuccess() && duplicates.data().length > 0) {
        <p class="text-muted-foreground text-sm tabular-nums">
          {{ duplicates.data().length | plural: 'group' }} · {{ totalWasted() }} can be freed
        </p>
      }
    </div>

    @if (duplicates.isPending()) {
      <div class="flex flex-col gap-4" aria-busy="true" aria-label="Loading duplicates">
        @for (i of [0, 1, 2]; track i) {
          <div class="rounded-xl border p-3">
            <div class="bg-muted mb-3 h-4 w-48 animate-pulse rounded"></div>
            <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <div class="bg-muted aspect-square animate-pulse rounded-lg"></div>
              <div class="bg-muted aspect-square animate-pulse rounded-lg"></div>
            </div>
          </div>
        }
      </div>
    }

    @if (duplicates.isError()) {
      <app-error-alert [error]="duplicates.error()" />
    }

    @if (duplicates.isSuccess()) {
      @if (duplicates.data().length === 0) {
        <div class="text-muted-foreground flex flex-col items-center gap-1 py-12 text-center">
          <p class="text-foreground font-medium">No duplicates</p>
          <p class="text-sm">Every file in your library is unique.</p>
        </div>
      } @else {
        <div class="min-h-0 flex-1 space-y-4 overflow-y-auto pb-4">
          @for (group of duplicates.data(); track group.contentHash) {
            <section class="rounded-xl border p-3" [attr.aria-label]="group.files.length + ' copies of ' + group.files[0]?.name">
              <p class="text-muted-foreground mb-3 text-sm tabular-nums">
                {{ group.files.length }} copies · {{ fmt(group.files[0]?.size ?? 0) }} each
              </p>
              <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                @for (file of group.files; track file.id) {
                  <div class="flex min-w-0 flex-col gap-2">
                    <a
                      [routerLink]="['/asset', file.id]"
                      class="bg-muted relative block aspect-square overflow-hidden rounded-lg"
                      [attr.aria-label]="'Open ' + file.name"
                    >
                      <img
                        [src]="apiUrl + '/asset/' + file.id + '/thumbnail'"
                        alt=""
                        loading="lazy"
                        class="h-full w-full object-cover outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
                      />
                      @if (file.type === 'video') {
                        <span class="absolute top-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white">Video</span>
                      }
                    </a>
                    <dl class="grid min-w-0 grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">
                      <dt class="text-muted-foreground">Path</dt>
                      <dd class="truncate font-mono" [title]="file.dir + '/' + file.name">{{ file.dir }}/{{ file.name }}</dd>
                      <dt class="text-muted-foreground">Size</dt>
                      <dd class="tabular-nums">{{ fmt(file.size) }}</dd>
                      <dt class="text-muted-foreground">Resolution</dt>
                      <dd class="tabular-nums">
                        @if (file.width && file.height) { {{ file.width }} × {{ file.height }} } @else { Unknown }
                      </dd>
                      <dt class="text-muted-foreground">Taken</dt>
                      <dd class="tabular-nums">
                        @if (file.takenAt) { {{ file.takenAt | date: 'mediumDate' }} } @else { Unknown }
                      </dd>
                      <dt class="text-muted-foreground">Added</dt>
                      <dd class="tabular-nums">{{ file.createdAt | date: 'mediumDate' }}</dd>
                    </dl>
                    <button
                      hlmBtn
                      size="sm"
                      variant="outline"
                      type="button"
                      class="mt-auto w-full transition-transform duration-100 active:scale-[0.96]"
                      [disabled]="busyGroup() === group.contentHash"
                      (click)="keepOnly(group, file)"
                    >
                      @if (busyGroup() === group.contentHash) { Deleting copies } @else { Keep this one }
                    </button>
                  </div>
                }
              </div>
            </section>
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
  private readonly toast = inject(ToastService);
  protected readonly apiUrl = environment.api.url;
  protected readonly busyGroup = signal<string | null>(null);

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

  keepOnly(group: DupeGroup, keep: DupeFile): void {
    const others = group.files.filter((f) => f.id !== keep.id);
    if (others.length === 0) return;
    const what = others.length === 1 ? 'the other copy' : `the other ${others.length} copies`;
    const raws = others.map((f) => f.rawName).filter((n): n is string => !!n);
    const rawNote = raws.length
      ? ` ${raws.length === 1 ? 'Its RAW file' : 'Their RAW files'} (${raws.join(', ')}) ${raws.length === 1 ? 'is' : 'are'} kept and will show as ${raws.length === 1 ? 'a photo' : 'photos'} of ${raws.length === 1 ? 'its' : 'their'} own.`
      : '';
    this.dialog
      .open(Confirm, {
        context: {
          type: 'danger',
          message: `Keep ${keep.dir}/${keep.name} and permanently delete ${what} from disk?${rawNote} You cannot undo this.`,
        },
      })
      .closed$.subscribe((confirmed: boolean) => {
        if (confirmed) void this.deleteOthers(group, others);
      });
  }

  private async deleteOthers(group: DupeGroup, others: DupeFile[]): Promise<void> {
    this.busyGroup.set(group.contentHash);
    await this.queryClient.cancelQueries({ queryKey: [CacheKey.DuplicatesAll] });
    let deleted = 0;
    const failed: DupeFile[] = [];
    for (const file of others) {
      try {
        await this.trpc.duplicates.deleteFile.mutate({ fileId: file.id });
        deleted++;
      } catch {
        failed.push(file);
      }
    }
    this.busyGroup.set(null);
    await this.queryClient.invalidateQueries({ queryKey: [CacheKey.DuplicatesAll] });
    if (failed.length === 0) {
      this.toast.success(deleted === 1 ? 'Deleted 1 copy' : `Deleted ${deleted} copies`);
    } else {
      this.toast.error(
        `Could not delete ${failed.length === 1 ? '1 copy' : `${failed.length} copies`}. Try again.`,
      );
    }
  }
}
