import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-settings-library',
  imports: [],
  template: `
    <p>
      settings-library works!
    </p>
  `,
  styles: `
    :host {
      display: block;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SettingsLibrary {

}
