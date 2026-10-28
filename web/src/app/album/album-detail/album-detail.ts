import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Confirm } from '@core/dialogs/confirm/confirm';
import { Auth } from '@core/services/auth/auth';
import { ToastService } from '@core/services/toast/toast';
import { HlmInput } from '@spartan-ng/helm/input';
import { UploadService } from '@core/services/upload/upload';
import { AlbumThumbnail } from '@core/components/album-thumbnail/album-thumbnail';
import { AlbumToolbar } from '@core/components/album-toolbar/album-toolbar';
import { AssetThumbnail } from '@core/components/asset-thumbnail/asset-thumbnail';
import { ErrorAlert } from '@core/components/error/error';
import { LoadingThumbnail } from '@core/components/loading-thumbnail/loading-thumbnail';
import { ThumbnailGrid } from '@core/components/thumbnail-grid/thumbnail-grid';
import { ShareItem } from '@core/dialogs/share-item/share-item';
import { BackOnEscapeDirective } from '@core/directives/back-on-escape/back-on-escape.directive';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideEllipsis,
  lucideImage,
  lucideImagePlus,
  lucidePencil,
  lucideShare2,
  lucideTrash2,
} from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { GridSkeleton } from '@core/components/loading-thumbnail/grid-skeleton';
import { SelectionBar } from '@core/components/selection-bar/selection-bar';
import { VirtualThumbnailGrid } from '@core/components/virtual-thumbnail-grid/virtual-thumbnail-grid';
import { GridSelection } from '@core/services/selection/grid-selection';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import type { RouterOutputs } from '@core/services/trpc';

@Component({
  selector: 'app-album-detail',
  imports: [
    GridSkeleton,
    SelectionBar,
    VirtualThumbnailGrid,
    ErrorAlert,
    AssetThumbnail,
    AlbumThumbnail,
    ThumbnailGrid,
    AlbumToolbar,
    LoadingThumbnail,
    HlmButton,
    HlmIcon,
    HlmInput,
    NgIcon,
    FormsModule,
  ],
  providers: [
    GridSelection,
    provideIcons({
      lucideEllipsis,
      lucideImage,
      lucideImagePlus,
      lucidePencil,
      lucideShare2,
      lucideTrash2,
    }),
  ],
  hostDirectives: [BackOnEscapeDirective],
  host: { class: 'flex h-full min-h-0 flex-col' },
  template: `
    @if (response.isPending() && !response.data()) {
      <app-grid-skeleton class="min-h-0 flex-1" [headers]="false" />
    } @else if (response.isError() && !response.data()) {
      <app-error-alert [error]="response.error() ?? undefined" />
    } @else {
      @let data = response.data()!;

      <div class="mb-2 flex items-center justify-between gap-3">
        @if (renaming()) {
          <form
            class="flex min-w-0 flex-1 items-center gap-2"
            (submit)="$event.preventDefault(); saveName(data.album.id)"
          >
            <input
              hlmInput
              class="h-11 min-w-0 flex-1 sm:h-9 sm:max-w-sm"
              aria-label="Album name"
              maxlength="200"
              [ngModel]="newName()"
              (ngModelChange)="newName.set($event)"
              [ngModelOptions]="{ standalone: true }"
              (keydown.escape)="renaming.set(false)"
              autofocus
            />
            <button
              hlmBtn
              type="submit"
              class="h-11 sm:h-9"
              [disabled]="busy() || !newName().trim()"
            >
              {{ busy() ? 'Saving' : 'Save' }}
            </button>
            <button
              hlmBtn
              variant="ghost"
              type="button"
              class="h-11 sm:h-9"
              (click)="renaming.set(false)"
            >
              Cancel
            </button>
          </form>
        } @else {
          <app-album-toolbar [items]="data.tree.ancestors" />
        }

        <div class="flex shrink-0 items-center gap-1">
          @if (data.album.canAdd && !renaming()) {
            <!-- Owner or collaborator: upload straight into this album. -->
            <button
              hlmBtn
              variant="outline"
              type="button"
              class="transition-transform active:scale-[0.96]"
              (click)="uploads.openPicker()"
            >
              <ng-icon hlm size="sm" name="lucideImagePlus" />
              <span class="hidden sm:inline">Add photos</span>
              <span class="sr-only sm:hidden">Add photos</span>
            </button>
          }
          @if (data.album.canManageShares && !renaming()) {
            <button
              hlmBtn
              variant="outline"
              type="button"
              class="transition-transform active:scale-[0.96]"
              (click)="openShareDialog(data.album.id, data.album.name)"
            >
              <ng-icon hlm size="sm" name="lucideShare2" />
              Share
            </button>
          }
          @if (isAdmin() && !renaming()) {
            <!-- Admin edits change the folder on the drive too. -->
            <div class="relative">
              <button
                type="button"
                class="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring grid size-11 place-items-center rounded-full transition-[background-color,color,scale] duration-150 outline-none focus-visible:ring-2 active:scale-[0.96] sm:size-9"
                aria-label="Album actions"
                aria-haspopup="menu"
                [attr.aria-expanded]="menuOpen()"
                (click)="menuOpen.set(!menuOpen())"
              >
                <ng-icon hlm size="base" name="lucideEllipsis" />
              </button>
              @if (menuOpen()) {
                <div
                  class="fixed inset-0 z-40"
                  aria-hidden="true"
                  (click)="menuOpen.set(false)"
                ></div>
                <div
                  role="menu"
                  aria-label="Album actions"
                  class="glass-strong motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 absolute top-full right-0 z-50 mt-1 flex w-60 origin-top-right flex-col rounded-xl p-1.5"
                  (keydown.escape)="menuOpen.set(false)"
                >
                  <button
                    type="button"
                    role="menuitem"
                    [class]="menuItemClass"
                    (click)="startRename(data.album.name)"
                  >
                    <ng-icon hlm size="sm" name="lucidePencil" class="text-muted-foreground" />
                    Rename folder
                  </button>
                  @if (data.album.cover) {
                    <button
                      type="button"
                      role="menuitem"
                      [class]="menuItemClass"
                      (click)="useAutoCover(data.album.id)"
                    >
                      <ng-icon hlm size="sm" name="lucideImage" class="text-muted-foreground" />
                      Use automatic cover
                    </button>
                  }
                  <p class="text-muted-foreground px-3 py-1.5 text-xs text-pretty">
                    To choose the cover, select one photo and pick Set as cover.
                  </p>
                  <button
                    type="button"
                    role="menuitem"
                    [class]="menuItemClass + ' text-red-700 dark:text-red-400'"
                    (click)="
                      confirmDelete(
                        data.album.id,
                        data.album.name,
                        data.album.items,
                        data.album.parentId
                      )
                    "
                  >
                    <ng-icon hlm size="sm" name="lucideTrash2" />
                    Delete folder
                  </button>
                </div>
              }
            </div>
          }
        </div>
      </div>

      @if (allItems().length === 0 && data.children.length === 0) {
        <p class="text-muted-foreground py-12 text-center text-sm">This album is empty.</p>
      } @else if (allItems().length === 0) {
        <!-- Only sub-albums: a plain wrapping grid that scrolls with the page. -->
        <div class="min-h-0 flex-1 overflow-y-auto">
          <app-thumbnail-grid>
            @for (child of data.children; track child.id) {
              <app-album-thumbnail [album]="child" />
            }
          </app-thumbnail-grid>
        </div>
      } @else {
        <!-- Sub-albums: a strip that is the grid's first row, so it scrolls
             away with the photos instead of staying at the top. -->
        <ng-template #subAlbums>
          <div class="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pt-0.5 pb-3">
            @for (child of data.children; track child.id) {
              <app-album-thumbnail class="w-36 shrink-0 snap-start sm:w-44" [album]="child" />
            }
          </div>
        </ng-template>

        <app-virtual-thumbnail-grid
          class="min-h-0 flex-1"
          [items]="allItems()"
          [scrollKey]="'album-' + data.album.id"
          [dateAccessor]="dateAccessor"
          [dayHeaders]="false"
          [leading]="data.children.length ? subAlbums : null"
        >
          <ng-template let-item>
            @if (item.loading) {
              <app-loading-thumbnail />
            } @else {
              <app-asset-thumbnail
                [from]="'/albums/' + data.album.id"
                [asset]="item"
                [albumId]="data.album.id"
              />
            }
          </ng-template>
        </app-virtual-thumbnail-grid>
        <app-selection-bar [albumId]="data.album.id" [allowDelete]="data.album.canAdd" />
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlbumDetail {
  private readonly trpc = injectTrpc();
  private readonly dialog = inject(HlmDialogService);
  private readonly queryClient = inject(QueryClient);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  protected readonly isAdmin = inject(Auth).isAdmin;
  protected readonly uploads = inject(UploadService);
  id = input.required<string>();

  protected readonly menuOpen = signal(false);
  protected readonly renaming = signal(false);
  protected readonly newName = signal('');
  protected readonly busy = signal(false);
  protected readonly menuItemClass =
    'hover:bg-glass-tint focus-visible:bg-glass-tint flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm outline-none transition-[background-color,scale] duration-100 active:scale-[0.98] disabled:opacity-50 sm:min-h-9';

  protected startRename(name: string): void {
    this.menuOpen.set(false);
    this.newName.set(name);
    this.renaming.set(true);
  }

  protected async saveName(albumId: string): Promise<void> {
    const name = this.newName().trim();
    if (!name || this.busy()) return;
    this.busy.set(true);
    try {
      await this.trpc.edit.renameAlbum.mutate({ albumId, name });
      this.renaming.set(false);
      this.toast.success(`Renamed to ${name}`);
      await this.queryClient.invalidateQueries();
    } catch (err) {
      this.toast.error((err as Error)?.message || 'Could not rename the folder. Try again.');
    } finally {
      this.busy.set(false);
    }
  }

  protected async useAutoCover(albumId: string): Promise<void> {
    this.menuOpen.set(false);
    try {
      await this.trpc.edit.setAlbumCover.mutate({ albumId, fileId: null });
      this.toast.success('The cover is automatic again');
      await this.queryClient.invalidateQueries();
    } catch (err) {
      this.toast.error((err as Error)?.message || 'Could not change the cover. Try again.');
    }
  }

  protected confirmDelete(
    albumId: string,
    name: string,
    items: number,
    parentId: string | null,
  ): void {
    this.menuOpen.set(false);
    this.dialog
      .open(Confirm, {
        context: {
          type: 'danger',
          message:
            `Delete the folder ${name} and its ${items === 1 ? '1 item' : `${items.toLocaleString()} items`}, ` +
            'with its sub-folders? It moves to the trash on the drive, and you can restore it from Settings, Trash.',
        },
      })
      .closed$.subscribe(async (confirmed: boolean) => {
        if (!confirmed) return;
        try {
          const res = await this.trpc.edit.deleteAlbum.mutate({ albumId });
          this.toast.success(`Moved ${name} (${res.files.toLocaleString()} items) to the trash`);
          await this.router.navigate(parentId ? ['/albums', parentId] : ['/albums']);
          await this.queryClient.invalidateQueries();
        } catch (err) {
          this.toast.error((err as Error)?.message || 'Could not delete the folder. Try again.');
        }
      });
  }

  response = injectQuery(() => ({
    queryKey: [CacheKey.AlbumSingle, this.id()],
    queryFn: () => this.trpc.album.getAlbumInfo.query(this.id()),
    // Only poll while an import is in flight; a settled album is static, so
    // there's nothing to refresh. This stops the album view from re-running
    // the (expensive) full-file-list query 720×/hour when nothing is importing.
    refetchInterval: (query: { state: { data?: RouterOutputs['album']['getAlbumInfo'] } }) =>
      (query.state.data?.album?.pendingTasks ?? 0) > 0 ? 5000 : false,
    staleTime: 5000,
  }));

  protected readonly dateAccessor = (item: { takenAt?: string | null; loading?: boolean }) =>
    item.loading ? null : (item.takenAt ?? null);

  allItems = computed(() => {
    const data = this.response.data();
    if (!data) return [];

    const files = data.files.map(
      (f: { type: 'image' | 'video'; id: string; blurhash?: string | null }) => ({
        ...f,
        loading: false,
      }),
    );
    const pendingCount = data.album.pendingTasks ?? 0;

    // Add placeholder items for pending files
    const placeholders = Array.from({ length: pendingCount }, (_, i) => ({
      id: `loading-${i}`,
      type: 'image' as const,
      loading: true,
    }));

    return [...files, ...placeholders];
  });

  openShareDialog(albumId: string, albumName: string) {
    this.dialog.open(ShareItem, {
      context: {
        sourceType: 'album',
        sourceId: albumId,
        title: albumName,
      },
    });
  }
}
