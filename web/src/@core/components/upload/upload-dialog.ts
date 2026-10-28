import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PluralPipe } from '@core/pipes/plural.pipe';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { UploadService, type UploadDestination } from '@core/services/upload/upload';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideFolderOpen, lucideImagePlus } from '@ng-icons/lucide';
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import {
  HlmDialogDescription,
  HlmDialogFooter,
  HlmDialogHeader,
  HlmDialogTitle,
} from '@spartan-ng/helm/dialog';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { formatBytes, isMediaFile, MEDIA_ACCEPT } from './upload-utils';

export type UploadDialogContext = {
  files?: File[];
  // Album to preselect (for example the album page the files were dropped on).
  albumId?: string | null;
};

type Target = 'default' | 'album' | 'new';

// Pick files (or a folder) and where they go: the default Uploads album, an
// album in the user's uploads folder, or a new album.
@Component({
  selector: 'app-upload-dialog',
  imports: [
    FormsModule,
    HlmButton,
    HlmDialogDescription,
    HlmDialogFooter,
    HlmDialogHeader,
    HlmDialogTitle,
    HlmIcon,
    HlmInput,
    HlmSpinner,
    NgIcon,
    PluralPipe,
    RouterLink,
  ],
  providers: [provideIcons({ lucideFolderOpen, lucideImagePlus })],
  template: `
    <hlm-dialog-header>
      <h3 hlmDialogTitle>Upload photos and videos</h3>
      <p hlmDialogDescription>Files upload in the background. You can keep using the app.</p>
    </hlm-dialog-header>

    @if (config.isPending()) {
      <div class="flex justify-center py-8"><hlm-spinner /></div>
    } @else if (config.data(); as cfg) {
      @if (!cfg.enabled) {
        <p class="text-muted-foreground rounded-lg border p-4 text-sm text-pretty">
          Uploads are off. An admin must set an uploads location in Settings, Storage.
        </p>
      } @else {
        <input
          #filesInput
          type="file"
          class="hidden"
          multiple
          [accept]="mediaAccept"
          (change)="onPicked(filesInput)"
        />
        <input
          #folderInput
          type="file"
          class="hidden"
          webkitdirectory
          multiple
          (change)="onPicked(folderInput, true)"
        />

        <div class="grid grid-cols-2 gap-2">
          <button
            type="button"
            class="hover:bg-accent flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-lg border p-3 text-sm font-medium transition-[background-color,scale] duration-100 active:scale-[0.96]"
            (click)="filesInput.click()"
          >
            <ng-icon hlm name="lucideImagePlus" class="text-muted-foreground" />
            Choose files
          </button>
          <button
            type="button"
            class="hover:bg-accent flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-lg border p-3 text-sm font-medium transition-[background-color,scale] duration-100 active:scale-[0.96]"
            (click)="folderInput.click()"
          >
            <ng-icon hlm name="lucideFolderOpen" class="text-muted-foreground" />
            Choose folder
          </button>
        </div>

        <p class="text-muted-foreground mt-3 min-h-5 text-sm tabular-nums" aria-live="polite">
          @if (files().length) {
            {{ files().length | plural: 'file' }} selected, {{ totalSize() }}
            @if (skipped()) {
              <span>. {{ skipped() | plural: 'file' }} skipped (not a photo or video)</span>
            }
            @if (tooBig()) {
              <span class="text-destructive">. {{ tooBig() | plural: 'file' }} over the {{ maxSize() }} limit</span>
            }
          } @else {
            No files selected yet.
          }
        </p>

        <fieldset class="mt-4 space-y-2">
          <legend class="mb-2 text-sm font-medium">Upload to</legend>

          <label class="hover:bg-accent/50 flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm">
            <input type="radio" name="target" value="default" [ngModel]="target()" (ngModelChange)="target.set($event)" />
            <span class="min-w-0 flex-1">
              <span class="font-medium">{{ cfg.defaultAlbumName }}</span>
              <span class="text-muted-foreground block text-xs">The default album for uploads</span>
            </span>
          </label>

          @if (cfg.albums.length) {
            <label class="hover:bg-accent/50 flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm">
              <input type="radio" name="target" value="album" [ngModel]="target()" (ngModelChange)="target.set($event)" />
              <span class="min-w-0 flex-1">
                <span class="font-medium">Existing album</span>
                <select
                  class="bg-background mt-1.5 block w-full rounded-md border px-2 py-1.5 text-sm"
                  aria-label="Album"
                  [ngModel]="albumId()"
                  (ngModelChange)="albumId.set($event); target.set('album')"
                >
                  @for (a of cfg.albums; track a.id) {
                    <option [value]="a.id">{{ a.path }}</option>
                  }
                </select>
              </span>
            </label>
          }

          <label class="hover:bg-accent/50 flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm">
            <input type="radio" name="target" value="new" [ngModel]="target()" (ngModelChange)="target.set($event)" />
            <span class="min-w-0 flex-1">
              <span class="font-medium">New album</span>
              <input
                hlmInput
                class="mt-1.5 h-9 w-full"
                placeholder="Album name"
                maxlength="100"
                [ngModel]="newName()"
                (ngModelChange)="newName.set($event); nameTyped.set(true); target.set('new')"
              />
            </span>
          </label>
        </fieldset>

        <p class="text-muted-foreground mt-3 text-xs">
          Up to {{ maxSize() }} per file. Duplicates of files already in your library are skipped.
        </p>
        <p class="text-muted-foreground mt-2 text-xs">
          Moving from Google Photos?
          <a
            class="text-foreground underline underline-offset-2"
            routerLink="/import/takeout"
            (click)="ref.close()"
            >Import a Google Takeout</a
          >
        </p>
      }
    } @else if (config.isError()) {
      <p class="text-destructive text-sm">Could not load upload settings. Try again.</p>
    }

    <hlm-dialog-footer class="mt-4">
      <button hlmBtn variant="ghost" (click)="ref.close()">Cancel</button>
      <button hlmBtn [disabled]="!canUpload()" (click)="start()">
        @if (uploadable().length) {
          Upload {{ uploadable().length | plural: 'file' }}
        } @else {
          Upload
        }
      </button>
    </hlm-dialog-footer>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UploadDialog {
  protected readonly ref = inject<BrnDialogRef<boolean>>(BrnDialogRef);
  private readonly context = injectBrnDialogContext<UploadDialogContext>();
  private readonly trpc = injectTrpc();
  private readonly uploads = inject(UploadService);

  protected readonly config = injectQuery(() => ({
    queryKey: [CacheKey.UploadConfig],
    queryFn: () => this.trpc.upload.config.query(),
  }));

  private readonly picked = signal<File[]>(this.context?.files ?? []);
  protected readonly skipped = computed(() => this.picked().length - this.files().length);
  protected readonly mediaAccept = MEDIA_ACCEPT;
  protected readonly files = computed(() => this.picked().filter(isMediaFile));

  // Preselect the album the user is looking at, when it is an upload album.
  protected readonly target = linkedSignal<Target>(() => {
    const id = this.context?.albumId;
    return id && this.config.data()?.albums.some((a) => a.id === id) ? 'album' : 'default';
  });
  protected readonly albumId = signal<string | null>(this.context?.albumId ?? null);
  protected readonly newName = signal('');
  // True once the user types a name. A picked folder then does not replace it.
  protected readonly nameTyped = signal(false);

  protected readonly maxBytes = computed(() => this.config.data()?.maxBytes ?? Infinity);
  protected readonly maxSize = computed(() => formatBytes(this.maxBytes()));
  protected readonly tooBig = computed(() => this.files().filter((f) => f.size > this.maxBytes()).length);
  protected readonly uploadable = computed(() => this.files().filter((f) => f.size <= this.maxBytes()));
  protected readonly totalSize = computed(() =>
    formatBytes(this.files().reduce((n, f) => n + f.size, 0)),
  );

  protected readonly canUpload = computed(() => {
    const cfg = this.config.data();
    if (!cfg?.enabled || !this.uploadable().length) return false;
    if (this.target() === 'new') return this.newName().trim().length > 0;
    if (this.target() === 'album') return !!this.selectedAlbum();
    return true;
  });

  private readonly selectedAlbum = computed(() => {
    const albums = this.config.data()?.albums ?? [];
    return albums.find((a) => a.id === this.albumId()) ?? albums[0] ?? null;
  });

  protected onPicked(input: HTMLInputElement, isFolder = false): void {
    const list = Array.from(input.files ?? []);
    input.value = '';
    if (!list.length) return;
    this.picked.set(list);
    // A folder becomes a new album. Its name is the folder's name, unless the
    // user already typed one.
    if (isFolder) {
      const folder = (list[0] as File & { webkitRelativePath?: string }).webkitRelativePath?.split('/')[0];
      if (folder && !(this.nameTyped() && this.newName().trim())) this.newName.set(folder);
      if (this.newName().trim()) this.target.set('new');
    }
  }

  protected start(): void {
    if (!this.canUpload()) return;
    let destination: UploadDestination = { kind: 'default' };
    const album = this.selectedAlbum();
    if (this.target() === 'album' && album) {
      destination = { kind: 'album', albumId: album.id, name: album.name };
    } else if (this.target() === 'new') {
      destination = { kind: 'new', name: this.newName().trim() };
    }
    this.uploads.enqueue(this.files(), destination, this.maxBytes());
    this.ref.close(true);
  }
}
