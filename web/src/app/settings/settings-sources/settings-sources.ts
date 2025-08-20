import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-settings-sources',
  imports: [],
  template: ` <p>settings-source works!</p> `,
  styles: `
    :host {
      display: block;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsSources {}
