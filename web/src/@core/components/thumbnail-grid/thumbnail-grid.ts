import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-thumbnail-grid',
  host: {
    class:
      'grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2 sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))] lg:grid-cols-[repeat(auto-fill,minmax(220px,1fr))]',
  },
  template: ` <ng-content /> `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThumbnailGrid {}
