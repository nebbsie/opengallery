import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ErrorAlert } from '@core/components/error/error';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc, RouterOutputs } from '@core/services/trpc';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCornerRightUp,
  lucideEye,
  lucideEyeOff,
  lucideFile,
  lucideFolder,
  lucideRefreshCcw,
} from '@ng-icons/lucide';
import { BrnDialogRef } from '@spartan-ng/brain/dialog';
import { HlmAlertDialogHeader } from '@spartan-ng/helm/alert-dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogFooter, HlmDialogTitle } from '@spartan-ng/helm/dialog';
import { HlmSwitch } from '@spartan-ng/helm/switch';
import { injectQuery } from '@tanstack/angular-query-experimental';

type LsResult = RouterOutputs['directory']['ls'];
type Entry = LsResult['entries'][number];

@Component({
  selector: 'app-path-select',
  standalone: true,
  providers: [
    provideIcons({
      lucideRefreshCcw,
      lucideFolder,
      lucideFile,
      lucideCornerRightUp,
      lucideEye,
      lucideEyeOff,
    }),
  ],
  imports: [
    ErrorAlert,
    HlmButton,
    NgIcon,
    HlmDialogFooter,
    HlmAlertDialogHeader,
    HlmDialogTitle,
    HlmSwitch,
  ],
  host: {
    class:
      'box-border flex h-[85dvh] max-h-[85dvh] w-[90vw] max-w-full flex-col overflow-hidden sm:h-[70vh] sm:max-h-[700px] sm:w-[600px]',
  },
  template: `
    <hlm-alert-dialog-header>
      <h3 hlmDialogTitle>File Browser</h3>
    </hlm-alert-dialog-header>

    <!-- Breadcrumb bar -->
    <div class="bg-muted/50 mt-3 flex items-center gap-2 rounded-lg border px-3 py-2">
      <div
        class="text-foreground min-w-0 flex-1 overflow-x-auto overflow-y-hidden text-sm whitespace-nowrap"
      >
        <div class="inline-flex min-w-0 items-center">
          @for (crumb of breadcrumbs(); track crumb.path; let last = $last) {
            <button
              type="button"
              class="text-foreground hover:text-primary transition-colors hover:underline"
              (click)="jumpTo(crumb.path)"
            >
              {{ crumb.label }}
            </button>
            @if (!last) {
              <span class="text-muted-foreground px-1">/</span>
            }
          }
        </div>
      </div>

      <button
        type="button"
        hlmBtn
        variant="ghost"
        size="icon"
        class="h-8 w-8 shrink-0"
        (click)="folders.refetch()"
      >
        <ng-icon name="lucideRefreshCcw" size="sm" [class.animate-spin]="folders.isFetching()" />
      </button>
    </div>

    <!-- Show hidden toggle -->
    <div class="mt-2 mb-1 flex items-center gap-2 self-end">
      <span class="text-muted-foreground text-xs select-none">Show hidden</span>
      <hlm-switch [checked]="showHidden()" (changed)="showHidden.set($event)" />
    </div>

    @if (folders.isError()) {
      <app-error-alert [error]="folders.error()" />
    }

    <div class="text-foreground flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">
      <div class="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        @if (canGoUp()) {
          <button
            type="button"
            class="hover:bg-accent/60 grid w-full min-w-0 cursor-pointer grid-cols-[20px_minmax(0,1fr)] items-center gap-3 border-b px-3 py-2.5 text-left text-sm transition-colors"
            (click)="goUp()"
          >
            <ng-icon name="lucideCornerRightUp" class="text-muted-foreground" size="sm" />
            <span class="text-muted-foreground truncate">..</span>
          </button>
        }

        @for (e of filteredData(); track e.path) {
          <button
            type="button"
            class="hover:bg-accent/60 grid w-full min-w-0 cursor-pointer grid-cols-[20px_minmax(0,1fr)] items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors"
            [class.text-muted-foreground]="e.name.startsWith('.')"
            (click)="open(e)"
          >
            <ng-icon
              size="sm"
              [name]="e.kind === 'dir' ? 'lucideFolder' : 'lucideFile'"
              [class]="e.kind === 'dir' ? 'text-primary' : 'text-muted-foreground'"
            ></ng-icon>
            <span class="min-w-0 truncate">{{ e.name }}</span>
          </button>
        }

        @if (!filteredData().length && !canGoUp()) {
          <div class="text-muted-foreground flex items-center justify-center py-8 text-sm">
            This folder is empty
          </div>
        }
      </div>
    </div>

    <hlm-dialog-footer class="mt-4 px-0 pb-[env(safe-area-inset-bottom)]">
      <button hlmBtn variant="outline" (click)="_dialogRef.close()">Cancel</button>
      <button hlmBtn (click)="selectCurrent()">Select this folder</button>
    </hlm-dialog-footer>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PathSelect {
  private trpc = injectTrpc();
  protected readonly _dialogRef = inject<BrnDialogRef<string | undefined>>(BrnDialogRef);

  currentPath = signal<string>('/');

  folders = injectQuery(() => {
    const path = this.currentPath();
    return {
      queryKey: [CacheKey.Directory, path],
      queryFn: () => this.trpc.directory.ls.query(path),
      enabled: !!path,
      keepPreviousData: true,
      staleTime: Infinity,
      gcTime: 1000 * 60 * 60 * 24 * 7,
    };
  });

  showHidden = signal(false);

  data = computed<Entry[]>(() => this.folders.data()?.entries ?? []);

  filteredData = computed<Entry[]>(() => {
    const entries = this.data();
    if (this.showHidden()) return entries;
    return entries.filter((e) => !e.name.startsWith('.'));
  });

  canGoUp = computed(() => this.currentPath() !== '/');

  breadcrumbs = computed(() => {
    const path = this.currentPath();
    if (path === '/') return [{ label: 'root', path: '/' }];
    const parts = path.replace(/\/+$/, '').split('/').filter(Boolean);
    const out: { label: string; path: string }[] = [{ label: 'root', path: '/' }];
    let cur = '';
    for (const p of parts) {
      cur += '/' + p;
      out.push({ label: p, path: cur });
    }
    return out;
  });

  open(e: Entry) {
    if (e.kind === 'dir') this.currentPath.set(e.path);
  }
  goUp() {
    const p = this.currentPath();
    if (p === '/') return;
    const trimmed = p.replace(/\/+$/, '');
    const idx = trimmed.lastIndexOf('/');
    this.currentPath.set(idx <= 0 ? '/' : trimmed.slice(0, idx));
  }
  goRoot() {
    this.currentPath.set('/');
  }
  jumpTo(path: string) {
    this.currentPath.set(path || '/');
  }
  selectCurrent() {
    this._dialogRef.close(this.currentPath());
  }
}
