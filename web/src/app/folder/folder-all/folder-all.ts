import { ChangeDetectionStrategy, Component } from '@angular/core';
import { injectTrpc } from '@core/services/trpc';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { CacheKey } from '@core/services/cache-key.types';
import { ErrorAlert } from '@core/components/error/error';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { ThumbnailGrid } from '@core/components/thumbnail-grid/thumbnail-grid';
import { AlbumToolbar } from '@core/components/album-toolbar/album-toolbar';
import { FolderThumbnail } from '@core/components/folder-thumbnail/folder-thumbnail';
import { FolderToolbar } from '@core/components/folder-toolbar/folder-toolbar';

@Component({
  selector: 'app-folder-all',
  imports: [ErrorAlert, HlmSpinner, ThumbnailGrid, FolderThumbnail, FolderToolbar],
  template: `
    @if (response.isPending()) {
      <hlm-spinner />
    }

    @if (response.isError() && response.error(); as error) {
      <app-error-alert [error]="error" />
    }

    @if (response.isSuccess()) {
      <app-folder-toolbar [items]="[]" />

      <app-thumbnail-grid>
        @for (folder of response.data(); track folder.id) {
          <app-folder-thumbnail [folder]="folder" />
        }
      </app-thumbnail-grid>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FolderAll {
  private readonly trpc = injectTrpc();

  response = injectQuery(() => ({
    queryKey: [CacheKey.FoldersAll],
    queryFn: async () => this.trpc.folder.getUsersFolders.query(),
  }));
}
