import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  HlmCard,
  HlmCardContent,
  HlmCardDescription,
  HlmCardFooter,
  HlmCardHeader,
  HlmCardTitle,
} from '@spartan-ng/helm/card';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmLabel } from '@spartan-ng/helm/label';
import { HlmInput } from '@spartan-ng/helm/input';
import { Router, RouterLink } from '@angular/router';
import { Logo } from '@core/components/logo/logo';
import { Auth } from '@core/services/auth/auth';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { HlmAlert, HlmAlertDescription, HlmAlertIcon, HlmAlertTitle } from '@spartan-ng/helm/alert';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { lucideCircleAlert } from '@ng-icons/lucide';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { injectTrpc } from '@core/services/trpc';
import { CacheKey } from '@core/services/cache-key.types';
import { injectQuery } from '@tanstack/angular-query-experimental';

@Component({
  selector: 'app-login-form',
  providers: [provideIcons({ lucideCircleAlert })],
  imports: [
    HlmCard,
    HlmCardHeader,
    HlmCardTitle,
    HlmCardDescription,
    HlmButton,
    HlmCardContent,
    HlmLabel,
    HlmInput,
    HlmCardFooter,
    RouterLink,
    Logo,
    ReactiveFormsModule,
    HlmAlert,
    HlmAlertDescription,
    HlmAlertTitle,
    NgIcon,
    HlmAlertIcon,
    HlmIcon,
    HlmSpinner,
  ],
  template: `
    @if (allowsRegistration.isSuccess()) {
      <div class="mb-6 flex justify-center">
        <app-logo />
      </div>
      <section class="w-full" hlmCard>
        <div hlmCardHeader>
          <h3 hlmCardTitle>Login to your account</h3>
          <p hlmCardDescription>Enter your email below to login to your account</p>
        </div>

        <div hlmCardContent>
          <form>
            <div class="flex flex-col gap-6">
              <div class="grid gap-2">
                <label hlmLabel for="email">Email</label>
                <input
                  [formControl]="emailControl"
                  type="email"
                  id="email"
                  placeholder="john@smith.com"
                  required
                  hlmInput
                />
              </div>

              <div class="grid gap-2">
                <div class="flex items-center">
                  <label hlmLabel for="password">Password</label>
                </div>
                <input [formControl]="passwordControl" type="password" id="password" hlmInput />
              </div>
            </div>
          </form>
        </div>

        <div hlmCardFooter class="flex-col gap-2">
          <button [disabled]="form.invalid" hlmBtn type="submit" class="w-full" (click)="login()">
            @if (loading()) {
              <hlm-spinner class="size-6" />
            } @else {
              Login
            }
          </button>

          @if (allowsRegistration.data()) {
            <a class="text-sm hover:underline" routerLink="/register">Need an account? Sign up</a>
          }
        </div>

        @if (error()) {
          <div hlmCardContent>
            <div hlmAlert variant="destructive">
              <ng-icon hlm hlmAlertIcon name="lucideCircleAlert" />
              <h4 hlmAlertTitle>Failed to login</h4>
              <div hlmAlertDescription>
                <p>Please check your details and try again.</p>
              </div>
            </div>
          </div>
        }
      </section>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginForm {
  private auth = inject(Auth);
  private router = inject(Router);
  private trpc = injectTrpc();

  error = signal(false);
  loading = signal(false);

  allowsRegistration = injectQuery(() => ({
    queryKey: [CacheKey.AllowsUserSelfRegistration],
    queryFn: async () => this.trpc.settings.allowsSelfRegistration.query(),
  }));

  emailControl = new FormControl<null | string>(null, [Validators.email, Validators.required]);
  passwordControl = new FormControl<null | string>(null, [
    Validators.required,
    Validators.minLength(5),
  ]);

  form = new FormGroup({
    email: this.emailControl,
    password: this.passwordControl,
  });

  async login() {
    if (this.emailControl.value === null || this.passwordControl.value === null) {
      return;
    }

    this.error.set(false);
    this.loading.set(true);

    const { error, data } = await this.auth.signInEmail({
      email: this.emailControl.value,
      password: this.passwordControl.value,
    });

    if (error) {
      this.error.set(true);
      this.loading.set(false);
      return;
    }

    if (data) {
      await this.router.navigate(['/gallery']);
    }
  }
}
