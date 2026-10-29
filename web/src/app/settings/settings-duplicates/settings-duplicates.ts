import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
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
import {
  buildSections,
  type DeletePlan,
  type DupeFile,
  type DupeGroup,
  type DupeSection,
  formatBytes,
  planKeepFile,
  planKeepIn,
  planKeepOldest,
} from './duplicate-sections';

// Deletes go to the server in batches, so one request never carries thousands
// of ids and the progress line can move.
const BATCH = 500;
// Thumbnails in a section's preview strip.
const STRIP = 8;

@Component({
  selector: 'app-settings-duplicates',
  imports: [ErrorAlert, HlmButton, DatePipe, RouterLink, PluralPipe],
  host: { class: 'flex flex-col w-full h-full overflow-hidden' },
  template: `
    <div class="flex shrink-0 flex-wrap items-start justify-between gap-x-4 gap-y-2 pb-3">
      <div class="min-w-0">
        <h1 class="text-foreground block text-lg font-bold">Duplicate files</h1>
        <p class="text-muted-foreground text-sm text-pretty">
          Copies with the same content, grouped by the folders they are in. Choose the folder to
          keep, and the other copies move to the trash. You can restore them from Settings, Trash.
        </p>
      </div>
      @if (sections().length > 0) {
        <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p class="text-muted-foreground text-sm tabular-nums">
            {{ totalGroups() | plural: 'group' }} · {{ fmt(totalFreeable()) }} can be freed
          </p>
          <button
            hlmBtn
            variant="outline"
            class="h-11 sm:h-9"
            [disabled]="busy()"
            (click)="cleanUpAll()"
          >
            Keep oldest of each
          </button>
        </div>
      }
    </div>

    @if (progress(); as p) {
      <div
        class="bg-muted/40 mb-3 flex shrink-0 items-center gap-3 rounded-lg border px-3 py-2 text-sm"
        role="status"
        aria-live="polite"
      >
        <div class="bg-muted h-1.5 flex-1 overflow-hidden rounded-full">
          <div
            class="bg-primary h-full rounded-full transition-[width] duration-300"
            [style.width.%]="(p.done / p.total) * 100"
          ></div>
        </div>
        <span class="text-muted-foreground tabular-nums">
          Moving to trash {{ p.done }} / {{ p.total }}
        </span>
      </div>
    }

    @if (duplicates.isPending()) {
      <div class="flex flex-col gap-3" aria-busy="true" aria-label="Loading duplicates">
        @for (i of [0, 1, 2]; track i) {
          <div class="rounded-xl border p-3">
            <div class="bg-muted mb-3 h-4 w-56 animate-pulse rounded"></div>
            <div class="flex gap-1.5">
              @for (j of [0, 1, 2, 3, 4]; track j) {
                <div class="bg-muted size-14 animate-pulse rounded-md"></div>
              }
            </div>
          </div>
        }
      </div>
    }

    @if (duplicates.isError()) {
      <app-error-alert [error]="duplicates.error()" />
    }

    @if (duplicates.isSuccess()) {
      @if (sections().length === 0) {
        <div class="text-muted-foreground flex flex-col items-center gap-1 py-12 text-center">
          <p class="text-foreground font-medium">No duplicates</p>
          <p class="text-sm">Every file in your library is unique.</p>
        </div>
      } @else {
        <div class="min-h-0 flex-1 space-y-3 overflow-y-auto pb-4">
          @for (s of sections(); track s.key) {
            <section
              class="rounded-xl border p-3"
              [attr.aria-label]="s.groups.length + ' duplicate groups in ' + folderNames(s)"
            >
              <!-- Header: the folders, counts, and the bulk actions. -->
              <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div class="min-w-0">
                  @if (s.folders.length === 1) {
                    <p class="text-foreground truncate text-sm font-medium" [title]="s.folders[0]!.dir">
                      {{ s.folders[0]!.label }}
                    </p>
                    <p class="text-muted-foreground text-xs">All copies are in this folder</p>
                  } @else {
                    <ul class="space-y-0.5">
                      @for (f of s.folders; track f.dir) {
                        <li class="text-foreground truncate text-sm font-medium" [title]="f.dir">
                          {{ f.label }}
                        </li>
                      }
                    </ul>
                    @if (s.base) {
                      <p class="text-muted-foreground truncate text-xs" [title]="s.base">
                        in {{ s.base }}
                      </p>
                    }
                  }
                  <p class="text-muted-foreground mt-1 text-xs tabular-nums">
                    {{ s.groups.length | plural: 'photo' }} with copies ·
                    {{ fmt(s.freeable) }} can be freed
                  </p>
                </div>

                <div class="flex shrink-0 flex-wrap gap-2 sm:max-w-[50%] sm:justify-end">
                  @if (s.folders.length === 1) {
                    <button
                      hlmBtn
                      size="sm"
                      class="h-11 sm:h-8"
                      [disabled]="busy()"
                      (click)="keepOldestIn(s)"
                    >
                      Keep one of each
                    </button>
                  } @else {
                    @for (f of s.folders; track f.dir) {
                      <button
                        hlmBtn
                        size="sm"
                        variant="outline"
                        class="h-11 max-w-full sm:h-8"
                        [title]="'Keep the copies in ' + f.dir"
                        [disabled]="busy()"
                        (click)="keepIn(s, f.dir, f.label)"
                      >
                        <span class="truncate">Keep in {{ f.label }}</span>
                      </button>
                    }
                  }
                </div>
              </div>

              <!-- Preview strip: one thumbnail per duplicated photo. -->
              <div class="mt-3 flex items-center gap-1.5 overflow-hidden">
                @for (g of s.groups.slice(0, STRIP); track g.contentHash) {
                  <img
                    [src]="thumb(g.files[0]!)"
                    alt=""
                    loading="lazy"
                    class="bg-muted size-14 shrink-0 rounded-md object-cover"
                  />
                }
                @if (s.groups.length > STRIP) {
                  <span class="text-muted-foreground shrink-0 pl-1 text-xs tabular-nums">
                    +{{ s.groups.length - STRIP }}
                  </span>
                }
              </div>

              <button
                type="button"
                class="text-muted-foreground hover:text-foreground focus-visible:ring-ring mt-2 -ml-1 inline-flex min-h-11 items-center rounded px-1 text-xs outline-none focus-visible:ring-2 sm:min-h-8"
                [attr.aria-expanded]="isOpen(s.key)"
                (click)="toggle(s.key)"
              >
                {{ isOpen(s.key) ? 'Hide' : 'Show' }} {{ s.groups.length | plural: 'group' }}
              </button>

              @if (isOpen(s.key)) {
                <!-- Per photo: each copy, and "Keep" to keep only that one. -->
                <ul class="mt-1 divide-y border-t">
                  @for (g of s.groups; track g.contentHash) {
                    <li class="flex gap-2 overflow-x-auto py-2">
                      @for (file of g.files; track file.id) {
                        <div class="flex w-36 shrink-0 flex-col gap-1">
                          <a
                            [routerLink]="['/asset', file.id]"
                            class="bg-muted relative block aspect-[4/3] overflow-hidden rounded-md"
                            [attr.aria-label]="'Open ' + file.name"
                          >
                            <img
                              [src]="thumb(file)"
                              alt=""
                              loading="lazy"
                              class="h-full w-full object-cover"
                            />
                            @if (file.type === 'video') {
                              <span
                                class="absolute top-1 left-1 rounded bg-black/60 px-1 py-0.5 text-[10px] text-white"
                                >Video</span
                              >
                            }
                          </a>
                          <p class="truncate text-xs font-medium" [title]="file.dir + '/' + file.name">
                            {{ file.name }}
                          </p>
                          <p class="text-muted-foreground truncate text-[11px]" [title]="file.dir">
                            {{ folderLabel(s, file.dir) }}
                          </p>
                          <p class="text-muted-foreground text-[11px] tabular-nums">
                            @if (file.width && file.height) {
                              {{ file.width }} × {{ file.height }} ·
                            }
                            added {{ file.createdAt | date: 'mediumDate' }}
                          </p>
                          <button
                            hlmBtn
                            size="sm"
                            variant="outline"
                            class="h-11 w-full sm:h-7"
                            [disabled]="busy()"
                            (click)="keepOnly(g, file)"
                          >
                            Keep this one
                          </button>
                        </div>
                      }
                    </li>
                  }
                </ul>
              }
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
  protected readonly STRIP = STRIP;
  protected readonly fmt = formatBytes;

  protected readonly progress = signal<{ done: number; total: number } | null>(null);
  protected readonly busy = computed(() => this.progress() !== null);
  private readonly open = signal<ReadonlySet<string>>(new Set());

  duplicates = injectQuery(() => ({
    queryKey: [CacheKey.DuplicatesAll],
    queryFn: () => this.trpc.duplicates.list.query(),
  }));

  protected readonly sections = computed(() =>
    buildSections((this.duplicates.data() ?? []) as DupeGroup[]),
  );
  protected readonly totalGroups = computed(() =>
    this.sections().reduce((n, s) => n + s.groups.length, 0),
  );
  protected readonly totalFreeable = computed(() =>
    this.sections().reduce((n, s) => n + s.freeable, 0),
  );

  protected thumb(file: DupeFile): string {
    return `${this.apiUrl}/asset/${file.id}/thumbnail`;
  }

  protected isOpen(key: string): boolean {
    return this.open().has(key);
  }

  protected toggle(key: string): void {
    const next = new Set(this.open());
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.open.set(next);
  }

  protected folderNames(s: DupeSection): string {
    return s.folders.map((f) => f.label).join(' and ');
  }

  protected folderLabel(s: DupeSection, dir: string): string {
    return s.folders.find((f) => f.dir === dir)?.label ?? dir;
  }

  protected keepIn(s: DupeSection, dir: string, label: string): void {
    const p = planKeepIn(s.groups, dir);
    const others = s.folders.filter((f) => f.dir !== dir).map((f) => f.label);
    this.confirmAndDelete(
      p,
      `Keep the copies in "${label}" and move ${this.copies(p)} from ` +
        `${others.map((o) => `"${o}"`).join(' and ')} to the trash?`,
    );
  }

  protected keepOldestIn(s: DupeSection): void {
    const p = planKeepOldest(s.groups);
    this.confirmAndDelete(
      p,
      `Keep the copy that was added first of each of ${p.groups} photos in ` +
        `"${s.folders[0]!.label}" and move ${this.copies(p)} to the trash?`,
    );
  }

  protected cleanUpAll(): void {
    const p = planKeepOldest(this.sections().flatMap((s) => s.groups));
    this.confirmAndDelete(
      p,
      `For each of the ${p.groups} photos with copies, keep the copy that was added to the ` +
        `library first, wherever it is, and move the other ${this.copies(p)} to the trash?`,
    );
  }

  protected keepOnly(group: DupeGroup, keep: DupeFile): void {
    const p = planKeepFile(group, keep);
    if (p.remove.length === 0) return;
    this.confirmAndDelete(
      p,
      `Keep ${keep.dir}/${keep.name} and move ${p.remove.length === 1 ? 'the other copy' : `the other ${p.remove.length} copies`} to the trash?`,
    );
  }

  private copies(p: DeletePlan): string {
    return `${p.remove.length} ${p.remove.length === 1 ? 'copy' : 'copies'} (${formatBytes(p.bytes)})`;
  }

  private confirmAndDelete(p: DeletePlan, question: string): void {
    if (p.remove.length === 0 || this.busy()) return;
    const raws = p.remove.map((f) => f.rawName).filter((n): n is string => !!n);
    const rawNote = raws.length
      ? ` ${raws.length === 1 ? 'One copy has a RAW file' : `${raws.length} copies have RAW files`}: the RAW stays and shows as a photo of its own.`
      : '';
    this.dialog
      .open(Confirm, {
        context: {
          type: 'danger',
          message: `${question}${rawNote} You can restore them from Settings, Trash.`,
        },
      })
      .closed$.subscribe((confirmed: boolean) => {
        if (confirmed) void this.run(p.remove.map((f) => f.id));
      });
  }

  private async run(ids: string[]): Promise<void> {
    this.progress.set({ done: 0, total: ids.length });
    await this.queryClient.cancelQueries({ queryKey: [CacheKey.DuplicatesAll] });
    let deleted = 0;
    const failed: { name: string; reason: string }[] = [];
    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH);
      try {
        const res = await this.trpc.duplicates.deleteFiles.mutate({ fileIds: batch });
        deleted += res.deleted;
        failed.push(...res.failed);
      } catch (e) {
        failed.push(
          ...batch.map(() => ({ name: '', reason: (e as Error)?.message || 'Request failed' })),
        );
      }
      this.progress.set({ done: Math.min(ids.length, i + batch.length), total: ids.length });
    }
    this.progress.set(null);
    await this.queryClient.invalidateQueries({ queryKey: [CacheKey.DuplicatesAll] });
    await this.queryClient.invalidateQueries({ queryKey: [CacheKey.TrashAll] });

    if (deleted > 0) {
      this.toast.success(
        deleted === 1 ? 'Moved 1 copy to the trash' : `Moved ${deleted} copies to the trash`,
      );
    }
    if (failed.length > 0) {
      const first = failed[0]!;
      this.toast.error(
        failed.length === 1
          ? `Could not delete ${first.name || 'a copy'}: ${first.reason}`
          : `Could not delete ${failed.length} copies: ${first.reason}`,
        { duration: 12000 },
      );
    }
  }
}
