import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-gallery',
  template: `<p>Gallery works!</p>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Gallery {}
