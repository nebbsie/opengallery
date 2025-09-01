import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-asset-thumbnail',
  imports: [],
  template: ` <p>asset-thumbnail works!</p> `,

  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssetThumbnail {}
