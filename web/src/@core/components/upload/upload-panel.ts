import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { PluralPipe } from '@core/pipes/plural.pipe';
import { UploadService, type UploadItem } from '@core/services/upload/upload';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCheck,
  lucideChevronDown,
  lucideChevronUp,
  lucideCircleAlert,
  lucidePause,
  lucidePlay,
  lucideRotateCw,
  lucideUpload,
  lucideX,
} from '@ng-icons/lucide';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { formatBytes } from './upload-utils';

// Upload progress. Bottom-right card on desktop; on mobile a sheet across the
// bottom, above the bottom nav and clear of the home indicator.
@Component({
  selector: 'app-upload-panel',
  imports: [NgIcon, HlmIcon, PluralPipe],
  providers: [
    provideIcons({
      lucideCheck,
      lucideChevronDown,
      lucideChevronUp,
      lucideCircleAlert,
      lucidePause,
      lucidePlay,
      lucideRotateCw,
      lucideUpload,
      lucideX,
    }),
  ],
  host: {
    class:
      'glass-strong text-popover-foreground fixed inset-x-3 bottom-(--upload-bottom) z-[60] flex max-h-[70dvh] flex-col overflow-hidden rounded-3xl motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[380px]',
    // The bottom dock is 3.5rem tall, 0.5rem above the home indicator inset.
    '[style.--upload-bottom]':
      "aboveNav() ? 'calc(4.5rem + env(safe-area-inset-bottom))' : 'calc(env(safe-area-inset-bottom) + 0.5rem)'",
    role: 'region',
    'aria-label': 'Uploads',
  },
  template: `
    <div class="flex items-center gap-3 py-2.5 pr-2 pl-4">
      <span
        class="grid size-8 shrink-0 place-items-center rounded-full"
        [class.bg-muted]="!t().failed || busy()"
        [class.bg-destructive/10]="t().failed && !busy()"
      >
        @if (busy()) {
          <ng-icon hlm size="sm" name="lucideUpload" class="text-muted-foreground" />
        } @else if (t().failed) {
          <ng-icon hlm size="sm" name="lucideCircleAlert" class="text-destructive" />
        } @else {
          <ng-icon hlm size="sm" name="lucideCheck" class="text-muted-foreground" />
        }
      </span>
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-medium tabular-nums">{{ title() }}</p>
        <p class="text-muted-foreground truncate text-xs tabular-nums">{{ subtitle() }}</p>
      </div>
      @if (canPauseAll()) {
        <button type="button" [class]="iconBtn" aria-label="Pause all" (click)="svc.pauseAll()">
          <ng-icon hlm size="sm" name="lucidePause" />
        </button>
      } @else if (t().paused) {
        <button type="button" [class]="iconBtn" aria-label="Resume all" (click)="svc.resumeAll()">
          <ng-icon hlm size="sm" name="lucidePlay" />
        </button>
      }
      <button
        type="button"
        [class]="iconBtn"
        [attr.aria-label]="svc.expanded() ? 'Hide list' : 'Show list'"
        [attr.aria-expanded]="svc.expanded()"
        (click)="svc.expanded.set(!svc.expanded())"
      >
        <ng-icon hlm size="sm" [name]="svc.expanded() ? 'lucideChevronDown' : 'lucideChevronUp'" />
      </button>
      @if (!busy() && !t().paused) {
        <button type="button" [class]="iconBtn" aria-label="Close" (click)="svc.close()">
          <ng-icon hlm size="sm" name="lucideX" />
        </button>
      }
    </div>

    <div class="bg-muted mx-4 mb-2 h-1 shrink-0 overflow-hidden rounded-full" aria-hidden="true">
      <div
        class="bg-primary h-full rounded-full transition-[width] duration-300 ease-out"
        [style.width.%]="percent()"
      ></div>
    </div>

    @if (svc.expanded()) {
      <ul class="min-h-0 flex-1 overflow-y-auto border-t px-2 py-1">
        @for (item of svc.items(); track item.id) {
          <li class="flex items-center gap-2 rounded-lg py-1.5 pr-1 pl-2">
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm" [class.text-muted-foreground]="item.state === 'cancelled'">
                {{ item.name }}
              </p>
              <p
                class="truncate text-xs tabular-nums"
                [class.text-destructive]="item.state === 'error'"
                [class.text-muted-foreground]="item.state !== 'error'"
              >
                {{ status(item) }}
              </p>
              @if (item.state === 'uploading' || item.state === 'paused') {
                <div class="bg-muted mt-1 h-0.5 overflow-hidden rounded-full" aria-hidden="true">
                  <div
                    class="h-full rounded-full transition-[width] duration-300 ease-out"
                    [class.bg-primary]="item.state === 'uploading'"
                    [class.bg-muted-foreground]="item.state === 'paused'"
                    [style.width.%]="itemPercent(item)"
                  ></div>
                </div>
              }
            </div>
            @switch (item.state) {
              @case ('uploading') {
                <button type="button" [class]="iconBtn" [attr.aria-label]="'Pause ' + item.name" (click)="svc.pause(item.id)">
                  <ng-icon hlm size="sm" name="lucidePause" />
                </button>
              }
              @case ('queued') {
                <button type="button" [class]="iconBtn" [attr.aria-label]="'Pause ' + item.name" (click)="svc.pause(item.id)">
                  <ng-icon hlm size="sm" name="lucidePause" />
                </button>
              }
              @case ('paused') {
                <button type="button" [class]="iconBtn" [attr.aria-label]="'Resume ' + item.name" (click)="svc.resume(item.id)">
                  <ng-icon hlm size="sm" name="lucidePlay" />
                </button>
              }
              @case ('error') {
                <button type="button" [class]="iconBtn" [attr.aria-label]="'Retry ' + item.name" (click)="svc.retry(item.id)">
                  <ng-icon hlm size="sm" name="lucideRotateCw" />
                </button>
              }
              @case ('done') {
                <ng-icon hlm size="sm" name="lucideCheck" class="text-muted-foreground mx-2.5" />
              }
              @case ('duplicate') {
                <ng-icon hlm size="sm" name="lucideCheck" class="text-muted-foreground mx-2.5" />
              }
            }
            @if (item.state !== 'done' && item.state !== 'duplicate' && item.state !== 'cancelled' && item.state !== 'finishing') {
              <button type="button" [class]="iconBtn" [attr.aria-label]="'Cancel ' + item.name" (click)="svc.cancel(item.id)">
                <ng-icon hlm size="sm" name="lucideX" />
              </button>
            }
          </li>
        }
      </ul>

      @if (t().failed || finishedCount() || busy()) {
        <div class="flex shrink-0 items-center justify-end gap-1 border-t px-2 py-1.5">
          @if (busy()) {
            <button type="button" [class]="textBtn" (click)="svc.cancelAll()">Cancel all</button>
          }
          @if (finishedCount()) {
            <button type="button" [class]="textBtn" (click)="svc.clearFinished()">Clear finished</button>
          }
          @if (t().failed) {
            <button type="button" [class]="textBtn" (click)="svc.retryFailed()">
              Retry {{ t().failed | plural: 'failed file' : 'failed files' }}
            </button>
          }
        </div>
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UploadPanel {
  protected readonly svc = inject(UploadService);
  /** True when the mobile bottom nav is on screen. */
  readonly aboveNav = input(false);

  protected readonly iconBtn =
    'text-muted-foreground hover:bg-accent hover:text-foreground grid size-9 shrink-0 place-items-center rounded-md transition-[background-color,color,scale] duration-100 active:scale-[0.96]';
  protected readonly textBtn =
    'hover:bg-accent rounded-md px-3 py-1.5 text-sm font-medium transition-[background-color,scale] duration-100 active:scale-[0.96]';

  protected readonly t = this.svc.totals;
  protected readonly busy = this.svc.isBusy;

  protected readonly percent = computed(() => {
    const { size, sent } = this.t();
    return size ? Math.min(100, (sent / size) * 100) : 0;
  });

  protected readonly canPauseAll = computed(() =>
    this.svc.items().some((i) => i.state === 'uploading' || i.state === 'queued'),
  );

  protected readonly finishedCount = computed(
    () =>
      this.svc
        .items()
        .filter((i) => i.state === 'done' || i.state === 'duplicate' || i.state === 'cancelled')
        .length,
  );

  protected readonly title = computed(() => {
    const t = this.t();
    if (this.busy()) return `Uploading ${t.done.toLocaleString()} of ${t.count.toLocaleString()}`;
    if (t.paused) return `${t.paused.toLocaleString()} paused`;
    if (t.failed) return `${t.failed.toLocaleString()} failed`;
    return 'Uploads complete';
  });

  protected readonly subtitle = computed(() => {
    const t = this.t();
    const speed = this.svc.speed();
    const sizes = `${formatBytes(t.sent)} of ${formatBytes(t.size)}`;
    if (!this.busy()) return sizes;
    if (speed < 1) return `${sizes}, starting`;
    const secs = Math.max(0, (t.size - t.sent) / speed);
    return `${formatBytes(speed)}/s, ${eta(secs)} left`;
  });

  protected itemPercent(item: UploadItem): number {
    return item.size ? Math.min(100, (item.sent / item.size) * 100) : 0;
  }

  protected status(item: UploadItem): string {
    switch (item.state) {
      case 'queued':
        return `Waiting, ${formatBytes(item.size)}`;
      case 'uploading':
        return `${Math.floor(this.itemPercent(item))}% of ${formatBytes(item.size)}`;
      case 'paused':
        return `Paused at ${Math.floor(this.itemPercent(item))}%`;
      case 'finishing':
        return 'Checking file';
      case 'done':
        return `Uploaded, ${formatBytes(item.size)}`;
      case 'duplicate':
        return 'Already in your library, skipped';
      case 'cancelled':
        return 'Cancelled';
      case 'error':
        return item.error ?? 'Upload failed';
    }
  }
}

function eta(secs: number): string {
  if (secs < 60) return 'less than a minute';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `about ${mins} min`;
  const h = Math.floor(mins / 60);
  return `about ${h} h ${mins % 60} min`;
}
