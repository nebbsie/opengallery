import { ChangeDetectionStrategy, Component } from '@angular/core';
import { LoginForm } from '@core/components/login-form/login-form';

@Component({
  selector: 'app-login',
  host: {
    class: 'flex flex-1 justify-center py-8',
  },
  template: ` <app-login-form class="w-full max-w-sm" /> `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LoginForm],
})
export class Login {}
