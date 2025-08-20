import { ChangeDetectionStrategy, Component } from '@angular/core';
import { injectTrpcClient } from '@core/services/trpc';

@Component({
  selector: 'app-settings-sources',
  template: ` <p>settings-source works!</p> `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsSources {
  private trpc = injectTrpcClient();

  test() {
    this.trpc.mediaLocations.create.mutate('aaron');
  }
}
