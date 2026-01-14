import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-settings',
  imports: [RouterOutlet],
  host: {
    class: 'flex flex-col h-full min-h-0 overflow-hidden',
  },
  template: ` <router-outlet /> `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Settings {}
