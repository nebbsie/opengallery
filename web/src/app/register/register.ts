import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RegisterForm } from '@core/components/register-form/register-form';

@Component({
  selector: 'app-register',
  host: {
    class: 'flex justify-center py-8',
  },
  template: ` <app-register-form class="w-full max-w-sm" /> `,
  imports: [RegisterForm],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Register {}
