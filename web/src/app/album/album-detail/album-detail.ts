// app-album-detail.ts
import { JsonPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, input } from '@angular/core';
import { ErrorAlert } from '@core/components/error/error';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { injectQuery } from '@tanstack/angular-query-experimental';

@Component({
  selector: 'app-album-detail',
  imports: [HlmSpinner, ErrorAlert, JsonPipe],
  template: `
    @if (response.isPending()) {
      <hlm-spinner />
    } @else if (response.isError()) {
      <app-error-alert [error]="response.error()" />
    } @else {
      @let data = response.data()!;
      <p>{{ data.album | json }}</p>
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
