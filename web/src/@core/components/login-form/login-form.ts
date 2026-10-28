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
    <!-- The card always renders. Only the "Sign up" link depends on the
         registration query, so a failed query never blanks the page. -->
    <div class="mb-6 flex justify-center">
      <app-logo />
    </div>
    <form class="w-full" hlmCard [formGroup]="form" (ngSubmit)="login()" novalidate>
      <div hlmCardHeader>
        <h1 hlmCardTitle class="text-balance">Log in to your account</h1>
        <p hlmCardDescription>Enter your email and password.</p>
      </div>

      <div hlmCardContent>
        <fieldset class="flex flex-col gap-6" [disabled]="loading()">
          <div class="grid gap-2">
            <label hlmLabel for="login-email">Email</label>
            <input
              formControlName="email"
              type="email"
              id="login-email"
              name="email"
              placeholder="john@smith.com"
              autocomplete="username"
              inputmode="email"
              autocapitalize="off"
              spellcheck="false"
              required
              hlmInput
              [attr.aria-invalid]="showError(emailControl) ? 'true' : null"
              [attr.aria-describedby]="showError(emailControl) ? 'login-email-error' : null"
            />
            @if (showError(emailControl)) {
              <p id="login-email-error" class="text-destructive text-sm">
                @if (emailControl.hasError('required')) {
                  Enter your email.
                } @else {
                  Enter a valid email address.
                }
              </p>
            }
          </div>

          <div class="grid gap-2">
            <label hlmLabel for="login-password">Password</label>
            <input
              formControlName="password"
              type="password"
              id="login-password"
              name="password"
              autocomplete="current-password"
              required
              hlmInput
              [attr.aria-invalid]="showError(passwordControl) ? 'true' : null"
              [attr.aria-describedby]="showError(passwordControl) ? 'login-password-error' : null"
            />
            @if (showError(passwordControl)) {
              <p id="login-password-error" class="text-destructive text-sm">Enter your password.</p>
            }
          </div>
        </fieldset>

        @if (error(); as message) {
          <div hlmAlert variant="destructive" class="mt-6" role="alert">
            <ng-icon hlm hlmAlertIcon name="lucideCircleAlert" />
            <h2 hlmAlertTitle>Could not log in</h2>
            <div hlmAlertDescription>
              <p>{{ message }}</p>
            </div>
          </div>
        }
      </div>

      <div hlmCardFooter class="flex-col gap-2">
        <button
          [disabled]="loading()"
          [attr.aria-busy]="loading()"
          hlmBtn
          type="submit"
          class="w-full transition-transform duration-100 active:scale-[0.96]"
        >
          @if (loading()) {
            <hlm-spinner class="size-5" />
            <span>Logging in</span>
          } @else {
            Log in
          }
        </button>

        @if (allowsRegistration.data()) {
          <a class="text-sm hover:underline" routerLink="/register">Need an account? Sign up</a>
        }
      </div>
    </form>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginForm {
  private auth = inject(Auth);
  private router = inject(Router);
  private trpc = injectTrpc();

  error = signal<string | null>(null);
  loading = signal(false);
  private submitted = signal(false);

  allowsRegistration = injectQuery(() => ({
    queryKey: [CacheKey.AllowsUserSelfRegistration],
    queryFn: async () => this.trpc.settings.allowsSelfRegistration.query(),
  }));

  emailControl = new FormControl<string>('', {
    nonNullable: true,
    validators: [Validators.email, Validators.required],
  });
  passwordControl = new FormControl<string>('', {
    nonNullable: true,
    validators: [Validators.required],
  });

  form = new FormGroup({
    email: this.emailControl,
    password: this.passwordControl,
  });

  showError(control: FormControl<string>): boolean {
    return control.invalid && (control.touched || this.submitted());
  }

  async login() {
    this.submitted.set(true);
    this.form.markAllAsTouched();
    if (this.form.invalid || this.loading()) {
      return;
    }

    this.error.set(null);
    this.loading.set(true);

    const { error, data } = await this.auth
      .signInEmail({
        email: this.emailControl.value.trim(),
        password: this.passwordControl.value,
      })
      .catch((e: unknown) => ({ error: e, data: null }));

    if (error || !data) {
      this.error.set(loginErrorMessage(error));
      this.loading.set(false);
      return;
    }

    await this.router.navigate(['/gallery']);
  }
}

function loginErrorMessage(error: unknown): string {
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 401 || status === 400) {
    return 'The email or password is wrong. Check them and try again.';
  }
  if (status === 429) {
    return 'Too many tries. Wait a minute and try again.';
  }
  if (status === 0 || (error instanceof TypeError && /fetch/i.test(error.message))) {
    return 'Could not reach the server. Check your connection and try again.';
  }
  const message = (error as { message?: unknown } | null)?.message;
  if (typeof message === 'string' && message.length > 0 && message.length < 160) {
    return message;
  }
  return 'Something went wrong. Try again.';
}
