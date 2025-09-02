// app-album-detail.ts
import { JsonPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, Signal } from '@angular/core';
import { ErrorAlert } from '@core/components/error/error';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { AssetThumbnail } from '@core/components/asset-thumbnail/asset-thumbnail';
import {
  HlmBreadcrumb,
  HlmBreadcrumbItem,
  HlmBreadcrumbLink,
  HlmBreadcrumbList,
  HlmBreadcrumbPage,
  HlmBreadcrumbSeparator,
} from '@spartan-ng/helm/breadcrumb';
import { RouterLink } from '@angular/router';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideHouse } from '@ng-icons/lucide';

@Component({
  selector: 'app-album-detail',
  imports: [
    HlmSpinner,
    ErrorAlert,
    JsonPipe,
    AssetThumbnail,
    HlmBreadcrumb,
    HlmBreadcrumbList,
    HlmBreadcrumbItem,
    HlmBreadcrumbSeparator,
    RouterLink,
    HlmBreadcrumbLink,
    HlmBreadcrumbPage,
    HlmIcon,
    NgIcon,
  ],
  providers: [
    provideIcons({
      lucideHouse,
    }),
  ],
  template: `
    @if (response.isPending()) {
      <hlm-spinner />
    } @else if (response.isError()) {
      <app-error-alert [error]="response.error()" />
    } @else {
      @let data = response.data()!;
      <!--      <p>{{ data.album | json }}</p>-->
      <!--      <p>{{ data.files | json }}</p>-->
      <!--      <p>{{ data.tree | json }}</p>-->

      <nav hlmBreadcrumb class="mb-4">
        <ol hlmBreadcrumbList>
          @let breadcrumbs = data.tree.ancestors;
          @for (crumb of breadcrumbs; track crumb.id; let isLast = $last; let isFirst = $first) {
            <!--Starting Album Icon Link Always-->
            @if (isFirst) {
              <li hlmBreadcrumbItem class="flex items-center">
                <a hlmBreadcrumbLink [link]="'/albums'">
                  <ng-icon
                    class="!text-muted-foreground !block h-6 w-6"
                    hlm
                    name="lucideHouse"
                    color="white"
                  />
                </a>
              </li>
              <li hlmBreadcrumbSeparator class="flex items-center"></li>
            }

            @if (!isLast) {
              <li hlmBreadcrumbItem class="flex items-center">
                <a hlmBreadcrumbLink [link]="'/albums/' + crumb.id">{{ crumb.name }}</a>
              </li>
              <li hlmBreadcrumbSeparator class="flex items-center"></li>
            } @else {
              <li hlmBreadcrumbItem class="flex items-center">
                <span hlmBreadcrumbPage>{{ crumb.name }}</span>
              </li>
            }
          }
        </ol>
      </nav>

      <div class="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
        @let childrenAlbums = data.tree.childrenAlbums;
        @for (childAlbum of childrenAlbums; track childAlbum.albumId) {
          <a
            class="flex w-full cursor-pointer flex-col"
            [routerLink]="'/albums/' + childAlbum.albumId"
          >
            <img
              [src]="childAlbum.cover || 'https://placehold.co/200x200'"
              alt="Album cover"
              class="mb-2 h-full w-full rounded-lg object-cover"
            />
            <p class="break-all">{{ childAlbum.name }}</p>
          </a>
        }

        @for (asset of data.files; track asset.id) {
          <app-asset-thumbnail [asset]="asset" />
        }
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlbumDetail {
  private readonly trpc = injectTrpc();
  id = input.required<string>();

  response = injectQuery(() => ({
    queryKey: [CacheKey.AlbumSingle, this.id()],
    queryFn: () => this.trpc.album.getAlbumInfo.query(this.id()),
  }));
}
