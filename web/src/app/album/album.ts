import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-album',
  imports: [RouterOutlet],
  host: { class: 'block h-full' },
  template: ` <router-outlet /> `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Album {}
