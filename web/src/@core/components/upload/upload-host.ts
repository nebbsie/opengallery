import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { Auth } from '@core/services/auth/auth';
import { CacheKey } from '@core/services/cache-key.types';
import { ToastService } from '@core/services/toast/toast';
import { injectTrpc } from '@core/services/trpc';
import { UploadService } from '@core/services/upload/upload';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCloudUpload } from '@ng-icons/lucide';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { filter, map, startWith } from 'rxjs';
import { UploadDialog, type UploadDialogContext } from './upload-dialog';
import { UploadPanel } from './upload-panel';
import { isMediaFile } from './upload-utils';

// Everything upload-related that sits above the pages: the progress panel, the
// picker dialog (opened by the Upload buttons through UploadService) and the
// drop target for files dragged onto the gallery or an album page.
@Component({
  selector: 'app-upload-host',
  imports: [UploadPanel, NgIcon, HlmIcon],
  providers: [provideIcons({ lucideCloudUpload })],
  host: { class: 'contents' },
  template: `
    @if (svc.panelOpen() && svc.items().length && !isAssetRoute()) {
      <app-upload-panel [aboveNav]="!isSettingsRoute()" />
    }

    @if (dragging()) {
      <div
        class="bg-background/80 pointer-events-none fixed inset-0 z-[70] grid place-items-center p-6 backdrop-blur-sm motion-safe:animate-in motion-safe:fade-in-0"
        aria-hidden="true"
      >
        <div class="border-primary flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-10 py-8 text-center">
          <ng-icon hlm size="xl" name="lucideCloudUpload" class="text-primary" />
          <p class="text-lg font-medium text-balance">Drop to upload</p>
          <p class="text-muted-foreground text-sm">{{ dropHint() }}</p>
        </div>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UploadHost {
  protected readonly svc = inject(UploadService);
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly dialog = inject(HlmDialogService);
  private readonly queryClient = inject(QueryClient);
  private readonly toast = inject(ToastService);
  private readonly trpc = injectTrpc();
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.url),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  protected readonly isAssetRoute = computed(() => this.url().startsWith('/asset/'));
  protected readonly isSettingsRoute = computed(() => this.url().startsWith('/settings'));
  // Album id of the album page on screen, if any.
  private readonly albumIdOnPage = computed(() => {
    const m = /^\/albums\/([^/?#]+)/.exec(this.url());
    return m && m[1] !== 'all' ? decodeURIComponent(m[1]!) : null;
  });
  private readonly dropAllowed = computed(() => {
    const url = this.url();
    return (
      this.auth.isAuthenticated() &&
      !this.auth.viewAs() &&
      (url === '/' || url.startsWith('/gallery') || !!this.albumIdOnPage())
    );
  });

  protected readonly dragging = signal(false);
  protected readonly dropHint = computed(() =>
    this.albumIdOnPage() ? 'Into this album when it is an upload album' : 'Into the Uploads album, or choose one',
  );
  private dragDepth = 0;

  constructor() {
    // Each Upload button press opens the picker.
    let seen = this.svc.pickerRequest();
    effect(() => {
      const n = this.svc.pickerRequest();
      if (n === seen) return;
      seen = n;
      untracked(() => this.openDialog({ albumId: this.albumIdOnPage() }));
    });

    if (!this.isBrowser) return;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e) || !this.dropAllowed()) return;
      e.preventDefault();
      this.dragDepth++;
      this.dragging.set(true);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e) || !this.dropAllowed()) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      this.dragDepth = Math.max(0, this.dragDepth - 1);
      if (this.dragDepth === 0) this.dragging.set(false);
    };
    const onDrop = (e: DragEvent) => {
      this.dragDepth = 0;
      this.dragging.set(false);
      if (!hasFiles(e) || !this.dropAllowed()) return;
      e.preventDefault();
      void this.handleDrop(Array.from(e.dataTransfer?.files ?? []));
    };
    document.addEventListener('dragenter', onEnter);
    document.addEventListener('dragover', onOver);
    document.addEventListener('dragleave', onLeave);
    document.addEventListener('drop', onDrop);
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('dragenter', onEnter);
      document.removeEventListener('dragover', onOver);
      document.removeEventListener('dragleave', onLeave);
      document.removeEventListener('drop', onDrop);
    });
  }

  private loadConfig() {
    return this.queryClient.fetchQuery({
      queryKey: [CacheKey.UploadConfig],
      queryFn: () => this.trpc.upload.config.query(),
    });
  }

  private async handleDrop(dropped: File[]): Promise<void> {
    const files = dropped.filter(isMediaFile);
    if (!files.length) {
      this.toast.error('Only photos and videos can be uploaded. Drop files, not folders.');
      return;
    }
    let cfg: Awaited<ReturnType<UploadHost['loadConfig']>>;
    try {
      cfg = await this.loadConfig();
    } catch {
      this.toast.error('Could not start the upload. Try again.');
      return;
    }
    // Dropped on an upload album: straight in, no questions.
    const albumId = this.albumIdOnPage();
    const album = albumId ? cfg.albums.find((a) => a.id === albumId) : undefined;
    if (cfg.enabled && album) {
      this.svc.enqueue(files, { kind: 'album', albumId: album.id, name: album.name }, cfg.maxBytes);
      return;
    }
    this.openDialog({ files });
  }

  private openDialog(context: UploadDialogContext): void {
    this.dialog.open(UploadDialog, {
      context,
      contentClass: 'sm:max-w-[520px] max-h-[90dvh] overflow-y-auto',
    });
  }
}
