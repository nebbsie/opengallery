import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
  Output,
  EventEmitter,
  inject,
} from '@angular/core';
import { injectTrpc, RouterOutputs } from '@core/services/trpc';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { CacheKey } from '@core/services/cache-key.types';
import { ErrorAlert } from '@core/components/error/error';
import { HlmButton } from '@spartan-ng/helm/button';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideHouse,
  lucideRefreshCcw,
  lucideFolder,
  lucideFile,
  lucideCornerRightUp,
} from '@ng-icons/lucide';
import { BrnDialogRef } from '@spartan-ng/brain/dialog';
import { HlmDialogFooter } from '@spartan-ng/helm/dialog';

type LsResult = RouterOutputs['directory']['ls'];
type Entry = LsResult['entries'][number];

@Component({
  selector: 'app-path-select',
  standalone: true,
  providers: [
    provideIcons({ lucideHouse, lucideRefreshCcw, lucideFolder, lucideFile, lucideCornerRightUp }),
  ],
  imports: [ErrorAlert, HlmButton, NgIcon, HlmDialogFooter],
  template: `
    <div class="mb-3 flex w-[400px] items-center gap-2">
      <div class="text-foreground min-w-0 flex-1 truncate text-sm" [title]="currentPath()">
        @for (crumb of breadcrumbs(); track crumb.path; let last = $last) {
          <button
            type="button"
            class="text-foreground hover:underline"
            (click)="jumpTo(crumb.path)"
          >
            {{ crumb.label }}
          </button>
          @if (!last) {
            <span class="text-foreground px-1">/</span>
          }
        }
      </div>

      <button
        class="text-foreground"
        type="button"
        hlmBtn
        variant="ghost"
        size="icon"
        (click)="folders.refetch()"
      >
        <ng-icon name="lucideRefreshCcw" [class.animate-spin]="folders.isFetching()" />
      </button>
    </div>

    @if (folders.isError()) {
      <app-error-alert [error]="folders.error()" />
    }

    <div class="text-foreground mb-6 overflow-hidden rounded-md border">
      <div
        class="bg-muted/50 text-foreground grid grid-cols-[24px_minmax(0,1fr)] gap-3 p-2 text-xs font-medium"
      >
        <span></span><span>Name</span>
      </div>

      <!-- Fixed-height scroll window -->
      <div class="relative h-72 min-w-0 divide-y overflow-auto">
        @if (canGoUp()) {
          <div class="bg-background sticky top-0 z-10">
            <button
              type="button"
              class="hover:bg-accent/60 grid w-full min-w-0 grid-cols-[24px_minmax(0,1fr)] items-center gap-3 px-3 py-2 text-left text-sm"
              (click)="goUp()"
            >
              <ng-icon name="lucideCornerRightUp" class="h-6 w-6" />
              <span class="truncate">...</span>
            </button>
          </div>
        }

        @for (e of data(); track e.path) {
          <button
            type="button"
            class="hover:bg-accent/60 grid w-full min-w-0 grid-cols-[24px_minmax(0,1fr)] items-center gap-3 px-3 py-2 text-left text-sm"
            (click)="open(e)"
          >
            <ng-icon
              class="h-6 w-6"
              [name]="e.kind === 'dir' ? 'lucideFolder' : 'lucideFile'"
            ></ng-icon>
            <!-- mid-word ellipsis -->
            <span class="min-w-0 truncate">{{ e.name }}</span>
          </button>
        }
      </div>
    </div>

    <hlm-dialog-footer>
      <button hlmBtn variant="ghost" (click)="_dialogRef.close()">Cancel</button>
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
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    };
  });

  data = computed<Entry[]>(() => this.folders.data()?.entries ?? []);
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
