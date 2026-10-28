import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatBytes } from '@core/components/upload/upload-utils';
import { PluralPipe } from '@core/pipes/plural.pipe';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideFileArchive, lucidePause, lucidePlay, lucideRotateCw, lucideX } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { SKIP_LABELS } from './takeout-plan';
import { TakeoutImport } from './takeout-import';

// Import from Google Takeout: pick the zips, see what is in them, run.
@Component({
  selector: 'app-takeout-page',
  imports: [RouterLink, PluralPipe, NgIcon, HlmIcon, HlmButton, HlmSpinner],
  providers: [provideIcons({ lucideFileArchive, lucidePause, lucidePlay, lucideRotateCw, lucideX })],
  host: { class: 'block h-full overflow-y-auto' },
  template: `
    <div class="mx-auto flex max-w-3xl flex-col gap-4 pb-8">
      <div>
        <h1 class="text-foreground text-lg font-bold">Import from Google Takeout</h1>
        <p class="text-muted-foreground text-sm text-pretty">
          In Google Takeout, export Google Photos, download all the zip files, and pick them here
          together. The browser reads the zips in place and uploads only the photos and videos, with
          their dates and locations. A photo in an album goes to Google Photos, then the album name;
          other photos go to Google Photos, then the year.
        </p>
      </div>

      <input
        #zipInput
        type="file"
        class="hidden"
        multiple
        accept=".zip,application/zip"
        (change)="onPicked(zipInput)"
      />

      @if (importer.error(); as error) {
        <p class="text-destructive rounded-lg border border-current/30 p-3 text-sm text-pretty" role="alert">
          {{ error }}
        </p>
      }

      @switch (importer.phase()) {
        @case ('idle') {
          <button
            type="button"
            class="hover:bg-accent flex min-h-28 flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-sm font-medium transition-[background-color,scale] duration-100 active:scale-[0.98]"
            (click)="zipInput.click()"
          >
            <ng-icon hlm name="lucideFileArchive" class="text-muted-foreground" />
            Choose the Takeout zip files
            <span class="text-muted-foreground text-xs font-normal">Pick every zip of the export at once</span>
          </button>
        }
        @case ('reading') {
          <div class="flex items-center gap-3 rounded-xl border p-4 text-sm" aria-live="polite">
            <hlm-spinner class="size-5" />
            <span class="tabular-nums">
              Reading the file lists, zip {{ importer.zipsRead() + 1 }} of {{ importer.zipCount() }}
            </span>
          </div>
        }
        @default {
          @if (importer.plan(); as plan) {
            <section class="glass grid gap-3 rounded-xl border p-4" aria-label="What is in the zips">
              <div class="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <p class="text-foreground text-2xl font-bold tabular-nums">
                  {{ plan.items.length | plural: 'photo or video' : 'photos and videos' }}
                </p>
                <p class="text-muted-foreground text-sm tabular-nums">
                  {{ size(plan.totalBytes) }} in {{ importer.zipCount() | plural: 'zip' }} ·
                  {{ plan.withJson.toLocaleString() }} with Google dates and places
                </p>
              </div>
              @if (space(); as sp) {
                <!-- Uploads and their encoded copies share the server disk. -->
                <p
                  class="text-sm tabular-nums text-pretty"
                  [class]="sp.short ? 'text-red-700 dark:text-red-400' : 'text-muted-foreground'"
                >
                  Needs about {{ size(sp.need) }} on the server, with the encoded copies.
                  {{ size(sp.free) }} is free.
                  @if (sp.short) {
                    That would leave less than {{ size(sp.reserve) }} free, so the import cannot
                    start. Free up space, or set a bigger uploads location in Settings, Storage.
                  }
                </p>
              }
              @if (importer.alreadyDone()) {
                <p class="text-sm tabular-nums">
                  {{ importer.alreadyDone().toLocaleString() }} already imported from these zips. They are
                  skipped.
                </p>
              }
              <details class="text-sm">
                <summary class="hover:text-foreground cursor-pointer select-none">
                  {{ plan.albums.length | plural: 'album' }} and {{ plan.years.length | plural: 'year' }}
                </summary>
                <ul class="text-muted-foreground mt-2 grid gap-x-4 gap-y-0.5 tabular-nums sm:grid-cols-2">
                  @for (a of plan.albums; track a.name) {
                    <li class="flex justify-between gap-2">
                      <span class="truncate">{{ a.name }}</span><span>{{ a.count.toLocaleString() }}</span>
                    </li>
                  }
                  @for (y of plan.years; track y.name) {
                    <li class="flex justify-between gap-2">
                      <span>{{ y.name }}</span><span>{{ y.count.toLocaleString() }}</span>
                    </li>
                  }
                </ul>
              </details>
              @if (plan.skipped.length) {
                <details class="text-sm">
                  <summary class="hover:text-foreground cursor-pointer select-none tabular-nums">
                    {{ skippedTotal().toLocaleString() }} files skipped
                  </summary>
                  <ul class="text-muted-foreground mt-2 grid gap-0.5 tabular-nums">
                    @for (s of plan.skipped; track s.reason) {
                      <li class="flex justify-between gap-2">
                        <span>{{ skipLabels[s.reason] }}</span><span>{{ s.count.toLocaleString() }}</span>
                      </li>
                    }
                  </ul>
                </details>
              }
            </section>

            @if (importer.phase() === 'running' || importer.phase() === 'paused' || importer.phase() === 'done') {
              @let p = importer.progress();
              <section class="grid gap-3 rounded-xl border p-4" aria-label="Progress">
                <div class="flex flex-wrap items-baseline justify-between gap-2 text-sm tabular-nums">
                  <span class="font-medium">
                    @if (importer.phase() === 'done') {
                      Finished
                    } @else if (importer.phase() === 'paused') {
                      Paused
                    } @else {
                      Importing
                    }
                    · {{ p.finished.toLocaleString() }} of {{ p.files.toLocaleString() }}
                  </span>
                  <span class="text-muted-foreground">
                    {{ size(p.sent) }} of {{ size(p.total) }}
                    @if (importer.phase() === 'running' && importer.speed() > 0) {
                      · {{ size(importer.speed()) }}/s
                    }
                  </span>
                </div>
                <div
                  class="bg-muted h-2 overflow-hidden rounded-full"
                  role="progressbar"
                  [attr.aria-valuenow]="percent()"
                  aria-valuemin="0"
                  aria-valuemax="100"
                >
                  <div class="bg-primary h-full rounded-full transition-[width] duration-300" [style.width.%]="percent()"></div>
                </div>
                <dl class="grid grid-cols-3 gap-2 text-center text-sm tabular-nums">
                  <div><dt class="text-muted-foreground text-xs">Uploaded</dt><dd class="font-semibold">{{ importer.uploaded().toLocaleString() }}</dd></div>
                  <div><dt class="text-muted-foreground text-xs">Already in library</dt><dd class="font-semibold">{{ importer.duplicates().toLocaleString() }}</dd></div>
                  <div><dt class="text-muted-foreground text-xs">Failed</dt><dd class="font-semibold">{{ importer.failures().length.toLocaleString() }}</dd></div>
                </dl>
                @if (importer.phase() !== 'done') {
                  <ul class="text-muted-foreground grid gap-0.5 text-xs">
                    @for (c of importer.current(); track c.id) {
                      <li class="truncate">{{ c.name }}</li>
                    }
                  </ul>
                  <p class="text-muted-foreground text-xs text-pretty">
                    Keep this tab open until the import finishes. You can use the rest of the app in the
                    meantime. If the tab closes, pick the same zips again to continue.
                  </p>
                }
              </section>
            }

            @if (importer.failures().length) {
              <details class="rounded-xl border p-4 text-sm">
                <summary class="cursor-pointer select-none tabular-nums">
                  {{ importer.failures().length | plural: 'file' }} failed
                </summary>
                <ul class="mt-2 grid gap-1">
                  @for (f of importer.failures(); track f.index) {
                    <li class="min-w-0">
                      <span class="font-medium">{{ f.name }}</span>
                      <span class="text-muted-foreground"> in {{ f.folder }}: {{ f.error }}</span>
                    </li>
                  }
                </ul>
              </details>
            }

            <div class="flex flex-wrap gap-2">
              @switch (importer.phase()) {
                @case ('ready') {
                  <button
                    hlmBtn
                    class="h-11 sm:h-9"
                    [disabled]="space()?.short"
                    (click)="importer.start()"
                  >
                    <ng-icon hlm size="sm" name="lucidePlay" />
                    {{ importer.alreadyDone() ? 'Continue import' : 'Start import' }}
                  </button>
                  <button hlmBtn variant="ghost" class="h-11 sm:h-9" (click)="zipInput.click()">
                    Choose other zips
                  </button>
                }
                @case ('running') {
                  <button hlmBtn variant="outline" class="h-11 sm:h-9" (click)="importer.pause()">
                    <ng-icon hlm size="sm" name="lucidePause" /> Pause
                  </button>
                  <button hlmBtn variant="ghost" class="h-11 sm:h-9" (click)="importer.cancel()">
                    <ng-icon hlm size="sm" name="lucideX" /> Stop
                  </button>
                }
                @case ('paused') {
                  <button hlmBtn class="h-11 sm:h-9" (click)="importer.resume()">
                    <ng-icon hlm size="sm" name="lucidePlay" /> Resume
                  </button>
                  <button hlmBtn variant="ghost" class="h-11 sm:h-9" (click)="importer.cancel()">
                    <ng-icon hlm size="sm" name="lucideX" /> Stop
                  </button>
                }
                @case ('done') {
                  <a hlmBtn class="h-11 sm:h-9" routerLink="/albums">View albums</a>
                  @if (importer.failures().length) {
                    <button hlmBtn variant="outline" class="h-11 sm:h-9" (click)="importer.retryFailed()">
                      <ng-icon hlm size="sm" name="lucideRotateCw" /> Retry failed
                    </button>
                  }
                  <button hlmBtn variant="ghost" class="h-11 sm:h-9" (click)="zipInput.click()">
                    Import more zips
                  </button>
                }
              }
            </div>
          }
        }
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TakeoutPage {
  protected readonly importer = inject(TakeoutImport);
  protected readonly skipLabels = SKIP_LABELS;

  protected readonly skippedTotal = computed(
    () => this.importer.plan()?.skipped.reduce((n, s) => n + s.count, 0) ?? 0,
  );

  private readonly trpc = injectTrpc();
  private readonly config = injectQuery(() => ({
    queryKey: [CacheKey.UploadConfig],
    queryFn: () => this.trpc.upload.config.query(),
  }));

  // Space check before a start: the files still to upload plus about 25% for
  // their encoded copies, against the server's free space, keeping a reserve
  // so the disk (it also holds the database) never fills up.
  protected readonly space = computed(() => {
    const plan = this.importer.plan();
    const free = this.config.data()?.freeBytes;
    if (!plan || free == null) return null;
    const reserve = 20 * 1024 ** 3;
    const done = this.importer.progress().sent;
    const need = Math.max(0, Math.round((plan.totalBytes - done) * 1.25));
    return { need, free, reserve, short: free - need < reserve };
  });

  protected readonly percent = computed(() => {
    const p = this.importer.progress();
    return p.total ? Math.min(100, Math.round((p.sent / p.total) * 1000) / 10) : 0;
  });

  protected size(bytes: number): string {
    return formatBytes(bytes);
  }

  protected onPicked(input: HTMLInputElement): void {
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length) void this.importer.pick(files);
  }
}
