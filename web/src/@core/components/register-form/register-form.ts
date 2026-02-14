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
    @if (isFirstUser.isSuccess()) {
      <div class="mb-6 flex justify-center">
        <app-logo />
      </div>
      <section class="w-full" hlmCard>
        <div hlmCardHeader>
          <h3 hlmCardTitle>Create an account</h3>
          <p hlmCardDescription>Enter your details below to create your account</p>
        </div>

        <div hlmCardContent>
          <form>
            <div class="flex flex-col gap-6">
              <div class="grid gap-2">
                <label hlmLabel for="name">Name</label>
                <input
                  [formControl]="nameControl"
                  type="text"
                  id="name"
                  placeholder="John Smith"
                  required
                  hlmInput
                />
              </div>

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
                <label hlmLabel for="password">Password</label>
                <input
                  [formControl]="passwordControl"
                  type="password"
                  id="password"
                  required
                  hlmInput
                />
              </div>
            </div>
          </form>
        </div>

        <div hlmCardFooter class="flex-col gap-2">
          <button
            [disabled]="form.invalid"
            hlmBtn
            type="submit"
            class="w-full"
            (click)="register()"
          >
            @if (loading()) {
              <hlm-spinner class="size-6" />
            } @else {
              Sign Up
            }
          </button>

          @if (!isFirstUser.data()) {
            <a class="text-sm hover:underline" routerLink="/login"
              >Already have an account? Log in</a
            >
          } @else {
            <div class="mt-4" hlmAlert>
              <ng-icon hlm hlmAlertIcon name="lucideInfo" />
              <h4 hlmAlertTitle>First-Time Setup</h4>
              <p hlmAlertDescription>Your first account will automatically become the admin.</p>
            </div>
          }
        </div>

        @if (error()) {
          <div hlmCardContent>
            @if (isStoragePathError()) {
              <div hlmAlert>
                <ng-icon hlm hlmAlertIcon name="lucideSettings" class="text-amber-500" />
                <h4 hlmAlertTitle>Server Configuration Required</h4>
                <div hlmAlertDescription>
                  <p class="mb-3">The server administrator needs to configure storage before creating the first account.</p>
                  <div class="rounded-md bg-muted p-3 text-sm">
                    <p class="font-medium">Required environment variable:</p>
                    <code class="text-foreground">STORAGE_PATH=/path/to/storage</code>
                  </div>
                </div>
              </div>
            } @else {
              <div hlmAlert variant="destructive">
                <ng-icon hlm hlmAlertIcon name="lucideCircleAlert" />
                <h4 hlmAlertTitle>Failed to register</h4>
                <div hlmAlertDescription>
                  <p>Please check your details and try again.</p>
                </div>
              </div>
            }
          </div>
        }
      </section>
    }
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

  emailControl = new FormControl<null | string>(null, [Validators.email, Validators.required]);
  passwordControl = new FormControl<null | string>(null, [
    Validators.required,
    Validators.minLength(8),
  ]);
  nameControl = new FormControl<null | string>(null, [
    Validators.required,
    Validators.minLength(4),
  ]);

  form = new FormGroup({
    email: this.emailControl,
    password: this.passwordControl,
    name: this.nameControl,
  });

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
    if (
      this.emailControl.value === null ||
      this.passwordControl.value === null ||
      this.nameControl.value === null
    ) {
      return;
    }

    this.error.set(false);
    this.errorMessage.set(null);
    this.errorCode.set(null);
    this.loading.set(true);

    const { error, data } = await this.auth.signUpEmail({
      email: this.emailControl.value,
      password: this.passwordControl.value,
      name: this.nameControl.value,
    });

    if (error) {
      console.error('Register failed:', error);
      this.error.set(true);
      const payload = this.extractErrorPayload(error);
      this.errorMessage.set(payload.message);
      this.errorCode.set(payload.code);
      this.loading.set(false);
      return;
    }

    if (data) {
      this.router.navigate(['/gallery']);
    }
  }
}
