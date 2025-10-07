import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { ErrorAlert } from '@core/components/error/error';
import { AssetThumbnail } from '@core/components/asset-thumbnail/asset-thumbnail';
import { ThumbnailGrid } from '@core/components/thumbnail-grid/thumbnail-grid';
import { injectTrpc } from '@core/services/trpc';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { CacheKey } from '@core/services/cache-key.types';
import { FolderThumbnail } from '@core/components/folder-thumbnail/folder-thumbnail';
import { FolderToolbar } from '@core/components/folder-toolbar/folder-toolbar';

@Component({
  selector: 'app-folder-detail',
  imports: [HlmSpinner, ErrorAlert, AssetThumbnail, ThumbnailGrid, FolderThumbnail, FolderToolbar],
  template: `
    @if (response.isPending()) {
      <hlm-spinner />
    } @else if (response.isError()) {
      <app-error-alert [error]="response.error()" />
    } @else {
      @let data = response.data()!;

      <app-folder-toolbar [items]="data.tree.ancestors" />

      @if (data.children.length) {
        <app-thumbnail-grid class="mb-4">
          @for (child of data.children; track child.id) {
            <app-folder-thumbnail [folder]="child" />
          }
        </app-thumbnail-grid>
      }

      @if (data.files.length) {
        @if (data.children.length !== 0) {
          <p class="mb-4 text-sm">Items</p>
        }

        <app-thumbnail-grid>
          @for (asset of data.files; track asset.id) {
            <app-asset-thumbnail
              [from]="'/folders/' + data.folder.id"
              [asset]="asset"
              [sourceId]="data.folder.id"
              sourceType="folder"
            />
          }
        </app-thumbnail-grid>
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FolderDetail {
  private readonly trpc = injectTrpc();
  id = input.required<string>();

  response = injectQuery(() => ({
    queryKey: [CacheKey.FolderSingle, this.id()],
    queryFn: () => this.trpc.folder.getFolderInfo.query(this.id()),
  }));
}
