import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Logo } from '@core/components/logo/logo';
import { Auth } from '@core/services/auth/auth';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleAlert, lucideInfo, lucideSettings } from '@ng-icons/lucide';
import { HlmAlert, HlmAlertDescription, HlmAlertIcon, HlmAlertTitle } from '@spartan-ng/helm/alert';
import { HlmButton } from '@spartan-ng/helm/button';
import {
  HlmCard,
  HlmCardContent,
  HlmCardDescription,
  HlmCardFooter,
  HlmCardHeader,
  HlmCardTitle,
} from '@spartan-ng/helm/card';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { injectQuery } from '@tanstack/angular-query-experimental';

@Component({
  selector: 'app-register-form',
  providers: [provideIcons({ lucideCircleAlert, lucideInfo, lucideSettings })],
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
    HlmAlert,
    HlmAlertDescription,
    HlmAlertIcon,
    HlmAlertTitle,
    HlmIcon,
    NgIcon,
    HlmSpinner,
    ReactiveFormsModule,
  ],
  template: `
    <!-- The card always renders. The first-user note only shows once the query
         answers, so a failed query never blanks the page. -->
    <div class="mb-6 flex justify-center">
      <app-logo />
    </div>
    <form class="w-full" hlmCard [formGroup]="form" (ngSubmit)="register()" novalidate>
      <div hlmCardHeader>
        <h1 hlmCardTitle class="text-balance">Create an account</h1>
        <p hlmCardDescription>Enter your details to create your account.</p>
      </div>

      <div hlmCardContent>
        <fieldset class="flex flex-col gap-6" [disabled]="loading()">
          <div class="grid gap-2">
            <label hlmLabel for="register-name">Name</label>
            <input
              formControlName="name"
              type="text"
              id="register-name"
              name="name"
              placeholder="John Smith"
              autocomplete="name"
              required
              hlmInput
              [attr.aria-invalid]="showError(nameControl) ? 'true' : null"
              [attr.aria-describedby]="showError(nameControl) ? 'register-name-error' : null"
            />
            @if (showError(nameControl)) {
              <p id="register-name-error" class="text-destructive text-sm">
                @if (nameControl.hasError('required')) {
                  Enter your name.
                } @else {
                  Use at least 2 characters.
                }
              </p>
            }
          </div>

          <div class="grid gap-2">
            <label hlmLabel for="register-email">Email</label>
            <input
              formControlName="email"
              type="email"
              id="register-email"
              name="email"
              placeholder="john@smith.com"
              autocomplete="email"
              inputmode="email"
              autocapitalize="off"
              spellcheck="false"
              required
              hlmInput
              [attr.aria-invalid]="showError(emailControl) ? 'true' : null"
              [attr.aria-describedby]="showError(emailControl) ? 'register-email-error' : null"
            />
            @if (showError(emailControl)) {
              <p id="register-email-error" class="text-destructive text-sm">
                @if (emailControl.hasError('required')) {
                  Enter your email.
                } @else {
                  Enter a valid email address.
                }
              </p>
            }
          </div>

          <div class="grid gap-2">
            <label hlmLabel for="register-password">Password</label>
            <input
              formControlName="password"
              type="password"
              id="register-password"
              name="password"
              autocomplete="new-password"
              required
              hlmInput
              [attr.aria-invalid]="showError(passwordControl) ? 'true' : null"
              aria-describedby="register-password-hint"
            />
            <p
              id="register-password-hint"
              class="text-sm"
              [class.text-destructive]="showError(passwordControl)"
              [class.text-muted-foreground]="!showError(passwordControl)"
            >
              Use at least 8 characters.
            </p>
          </div>
        </fieldset>

        @if (error()) {
          <div class="mt-6" role="alert">
            @if (isStoragePathError()) {
              <div hlmAlert>
                <ng-icon hlm hlmAlertIcon name="lucideSettings" class="text-amber-500" />
                <h2 hlmAlertTitle>Server setup needed</h2>
                <div hlmAlertDescription>
                  <p class="mb-3">The server administrator must set the storage path before the first account can be made.</p>
                  <div class="rounded-md bg-muted p-3 text-sm">
                    <p class="font-medium">Set this environment variable:</p>
                    <code class="text-foreground">STORAGE_PATH=/path/to/storage</code>
                  </div>
                </div>
              </div>
            } @else {
              <div hlmAlert variant="destructive">
                <ng-icon hlm hlmAlertIcon name="lucideCircleAlert" />
                <h2 hlmAlertTitle>Could not create the account</h2>
                <div hlmAlertDescription>
                  <p>{{ friendlyError() }}</p>
                </div>
              </div>
            }
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
            <span>Creating account</span>
          } @else {
            Sign up
          }
        </button>

        @if (isFirstUser.data()) {
          <div class="mt-4" hlmAlert>
            <ng-icon hlm hlmAlertIcon name="lucideInfo" />
            <h2 hlmAlertTitle>First-time setup</h2>
            <p hlmAlertDescription>The first account becomes the admin.</p>
          </div>
        } @else {
          <a class="text-sm hover:underline" routerLink="/login">Already have an account? Log in</a>
        }
      </div>
    </form>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RegisterForm {
  private auth = inject(Auth);
  private router = inject(Router);
  private trpc = injectTrpc();

  isFirstUser = injectQuery(() => ({
    queryKey: [CacheKey.IsFirstUser],
    queryFn: async () => this.trpc.users.isFirstSignup.query(),
  }));

  error = signal(false);
  errorMessage = signal<string | null>(null);
  errorCode = signal<string | null>(null);
  loading = signal(false);

  private submitted = signal(false);

  emailControl = new FormControl<string>('', {
    nonNullable: true,
    validators: [Validators.email, Validators.required],
  });
  passwordControl = new FormControl<string>('', {
    nonNullable: true,
    validators: [Validators.required, Validators.minLength(8)],
  });
  nameControl = new FormControl<string>('', {
    nonNullable: true,
    validators: [Validators.required, Validators.minLength(2)],
  });

  form = new FormGroup({
    email: this.emailControl,
    password: this.passwordControl,
    name: this.nameControl,
  });

  showError(control: FormControl<string>): boolean {
    return control.invalid && (control.touched || this.submitted());
  }

  friendlyError(): string {
    const code = this.errorCode();
    if (code === 'USER_ALREADY_EXISTS' || code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL') {
      return 'An account with this email already exists. Log in instead.';
    }
    if (code === 'PASSWORD_TOO_SHORT') return 'The password is too short. Use at least 8 characters.';
    if (code === 'INVALID_EMAIL') return 'Enter a valid email address.';
    const msg = this.errorMessage();
    if (msg && msg.length < 160) return msg;
    return 'Something went wrong. Check your details and try again.';
  }

  isStoragePathError() {
    const msg = this.errorMessage();
    const code = this.errorCode();
    const isFirstUser = this.isFirstUser.data() ?? false;
    return (msg?.includes('STORAGE_PATH') ?? false) || (code === 'FAILED_TO_CREATE_USER' && isFirstUser);
  }

  private extractErrorPayload(error: unknown) {
    if (!error || typeof error !== 'object') {
      return { message: null, code: null };
    }

    const anyError = error as {
      message?: unknown;
      code?: unknown;
      error?: unknown;
    };

    const payload = {
      message: null as string | null,
      code: typeof anyError.code === 'string' ? anyError.code : null,
    };

    if (typeof anyError.error === 'string') {
      payload.message = anyError.error;
      return payload;
    }

    if (anyError.error && typeof anyError.error === 'object') {
      const nested = anyError.error as { message?: unknown; code?: unknown };
      const nestedMessage = nested.message;
      if (!payload.code && typeof nested.code === 'string') {
        payload.code = nested.code;
      }
      if (typeof nestedMessage === 'string') {
        payload.message = nestedMessage;
        return payload;
      }
    }

    if (typeof anyError.message === 'string') {
      payload.message = anyError.message;
      return payload;
    }

    return payload;
  }

  async register() {
    this.submitted.set(true);
    this.form.markAllAsTouched();
    if (this.form.invalid || this.loading()) {
      return;
    }

    this.error.set(false);
    this.errorMessage.set(null);
    this.errorCode.set(null);
    this.loading.set(true);

    const { error, data } = await this.auth
      .signUpEmail({
        email: this.emailControl.value.trim(),
        password: this.passwordControl.value,
        name: this.nameControl.value.trim(),
      })
      .catch((e: unknown) => ({ error: e, data: null }));

    if (error || !data) {
      this.error.set(true);
      const payload = this.extractErrorPayload(error);
      this.errorMessage.set(payload.message);
      this.errorCode.set(payload.code);
      this.loading.set(false);
      return;
    }

    await this.router.navigate(['/gallery']);
  }
}
