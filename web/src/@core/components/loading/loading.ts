import { ChangeDetectionStrategy, Component } from '@angular/core';
import { HlmSpinner } from '@spartan-ng/helm/spinner';

// Centered page/panel loading state. Fills the available space (grows as a flex
// child, falls back to a min height in block contexts) and centers the spinner,
// so loaders no longer sit in the top-left corner.
@Component({
  selector: 'app-loading',
  imports: [HlmSpinner],
  host: {
    class: 'flex min-h-[50vh] w-full flex-1 items-center justify-center',
  },
  template: `<hlm-spinner />`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Loading {}
