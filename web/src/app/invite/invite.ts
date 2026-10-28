import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Logo } from '@core/components/logo/logo';
import { Auth } from '@core/services/auth/auth';
import { injectTrpc } from '@core/services/trpc';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleAlert, lucideEye, lucideEyeOff, lucideLink2Off } from '@ng-icons/lucide';
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

// Declared locally so the template stays typed even when the tRPC router type
// resolves to `any` in the production build.
type InviteLookup =
  | { status: 'invalid' | 'expired' | 'used' | 'revoked' }
  | { status: 'pending'; name: string; email: string };

const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;

function passwordsMatch(group: AbstractControl): ValidationErrors | null {
  const password = group.get('password')?.value;
  const confirm = group.get('confirm')?.value;
  return password && confirm && password !== confirm ? { mismatch: true } : null;
}

/**
 * Public page for a single-use invite link (/invite/:token). The admin already
 * chose the name, email and what the new user can see; the invitee only sets a
 * password, then lands in the gallery signed in.
 */
@Component({
  selector: 'app-invite',
  providers: [provideIcons({ lucideCircleAlert, lucideEye, lucideEyeOff, lucideLink2Off })],
  imports: [
    HlmAlert,
    HlmAlertDescription,
    HlmAlertIcon,
    HlmAlertTitle,
    HlmButton,
    HlmCard,
    HlmCardContent,
    HlmCardDescription,
    HlmCardFooter,
    HlmCardHeader,
    HlmCardTitle,
    HlmIcon,
    HlmInput,
    HlmLabel,
    HlmSpinner,
    Logo,
    NgIcon,
    ReactiveFormsModule,
    RouterLink,
  ],
  host: {
    class: 'flex flex-1 justify-center px-4 py-8',
  },
  template: `
    <div class="w-full max-w-sm">
      <div class="mb-6 flex justify-center">
        <app-logo />
      </div>

      @if (!auth.ready() || (canLookup() && lookup.isPending())) {
        <div class="flex justify-center py-12">
          <hlm-spinner />
        </div>
      } @else if (auth.isAuthenticated() && !submitting()) {
        <section class="w-full" hlmCard>
          <div hlmCardHeader>
            <h3 hlmCardTitle>You are already signed in</h3>
            <p hlmCardDescription>
              You are signed in as {{ auth.user()?.name || auth.user()?.email || 'another user' }}.
              Sign out to accept this invite.
            </p>
          </div>
          <div hlmCardFooter class="flex-col gap-2">
            <button hlmBtn type="button" class="w-full" [disabled]="signingOut()" (click)="signOut()">
              @if (signingOut()) {
                <hlm-spinner class="size-6" />
              } @else {
                Sign out
              }
            </button>
            <a class="text-sm hover:underline" routerLink="/gallery">Go to the gallery</a>
          </div>
        </section>
      } @else if (invite(); as data) {
        @if (data.status === 'pending') {
          <section class="w-full" hlmCard>
            <div hlmCardHeader>
              <h3 hlmCardTitle>Hi {{ data.name }}, you have been invited to OpenGallery</h3>
              <p hlmCardDescription>Choose a password to create your account.</p>
            </div>

            <div hlmCardContent>
              <form [formGroup]="form" (ngSubmit)="submit(data.email)" id="invite-form" novalidate>
                <div class="flex flex-col gap-6">
                  <div class="grid gap-2">
                    <label hlmLabel for="email">Email</label>
                    <input
                      type="email"
                      id="email"
                      [value]="data.email"
                      readonly
                      class="bg-muted text-muted-foreground"
                      hlmInput
                    />
                  </div>

                  <div class="grid gap-2">
                    <label hlmLabel for="name">Name</label>
                    <input
                      formControlName="name"
                      type="text"
                      id="name"
                      autocomplete="name"
                      maxlength="100"
                      [attr.aria-invalid]="showError(nameControl) || null"
                      hlmInput
                    />
                    @if (showError(nameControl)) {
                      <p class="text-destructive text-sm">Enter your name.</p>
                    }
                  </div>

                  <div class="grid gap-2">
                    <label hlmLabel for="password">Password</label>
                    <div class="relative">
                      <input
                        formControlName="password"
                        [type]="showPassword() ? 'text' : 'password'"
                        id="password"
                        autocomplete="new-password"
                        class="w-full pr-10"
                        [attr.aria-invalid]="showError(passwordControl) || null"
                        aria-describedby="password-help"
                        hlmInput
                      />
                      <button
                        type="button"
                        class="text-muted-foreground hover:text-foreground absolute inset-y-0 right-0 flex w-10 items-center justify-center"
                        [attr.aria-label]="showPassword() ? 'Hide password' : 'Show password'"
                        [attr.aria-pressed]="showPassword()"
                        (click)="showPassword.set(!showPassword())"
                      >
                        <ng-icon hlm size="sm" [name]="showPassword() ? 'lucideEyeOff' : 'lucideEye'" />
                      </button>
                    </div>
                    @if (showError(passwordControl)) {
                      <p id="password-help" class="text-destructive text-sm">
                        @if (passwordControl.hasError('required')) {
                          Enter a password.
                        } @else if (passwordControl.hasError('maxlength')) {
                          Use 128 characters or fewer.
                        } @else {
                          Use at least 8 characters.
                        }
                      </p>
                    } @else {
                      <p id="password-help" class="text-muted-foreground text-sm">
                        At least 8 characters.
                      </p>
                    }
                  </div>

                  <div class="grid gap-2">
                    <label hlmLabel for="confirm">Confirm password</label>
                    <input
                      formControlName="confirm"
                      [type]="showPassword() ? 'text' : 'password'"
                      id="confirm"
                      autocomplete="new-password"
                      [attr.aria-invalid]="showConfirmError() || null"
                      hlmInput
                    />
                    @if (showConfirmError()) {
                      <p class="text-destructive text-sm">
                        @if (confirmControl.hasError('required')) {
                          Type the password again.
                        } @else {
                          The passwords do not match.
                        }
                      </p>
                    }
                  </div>
                </div>
              </form>
            </div>

            <div hlmCardFooter class="flex-col gap-2">
              <button
                hlmBtn
                type="submit"
                form="invite-form"
                class="w-full"
                [disabled]="submitting()"
              >
                @if (submitting()) {
                  <hlm-spinner class="size-6" />
                } @else {
                  Create my account
                }
              </button>
            </div>

            @if (submitError(); as message) {
              <div hlmCardContent>
                <div hlmAlert variant="destructive">
                  <ng-icon hlm hlmAlertIcon name="lucideCircleAlert" />
                  <h4 hlmAlertTitle>Could not create your account</h4>
                  <div hlmAlertDescription>
                    <p>{{ message }}</p>
                  </div>
                </div>
              </div>
            }
          </section>
        } @else {
          <section class="w-full" hlmCard>
            <div hlmCardHeader>
              <div class="text-muted-foreground mb-2 flex justify-center">
                <ng-icon hlm size="lg" name="lucideLink2Off" />
              </div>
              <h3 hlmCardTitle class="text-center">{{ statusTitle()[data.status] }}</h3>
              <p hlmCardDescription class="text-center">{{ statusDetail()[data.status] }}</p>
            </div>
            <div hlmCardFooter class="flex-col gap-2">
              @if (data.status === 'used') {
                <a hlmBtn class="w-full" routerLink="/login">Sign in</a>
              } @else {
                <a class="text-sm hover:underline" routerLink="/login">Already have an account? Sign in</a>
              }
            </div>
          </section>
        }
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Invite {
  token = input.required<string>();

  protected readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly trpc = injectTrpc();

  protected readonly submitting = signal(false);
  protected readonly submitted = signal(false);
  protected readonly signingOut = signal(false);
  protected readonly showPassword = signal(false);
  protected readonly submitError = signal<string | null>(null);

  protected readonly nameControl = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.maxLength(100)],
  });
  protected readonly passwordControl = new FormControl('', {
    nonNullable: true,
    validators: [
      Validators.required,
      Validators.minLength(MIN_PASSWORD),
      Validators.maxLength(MAX_PASSWORD),
    ],
  });
  protected readonly confirmControl = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required],
  });
  protected readonly form = new FormGroup(
    { name: this.nameControl, password: this.passwordControl, confirm: this.confirmControl },
    { validators: passwordsMatch },
  );

  // Look the token up only once auth has settled and nobody is signed in.
  protected readonly canLookup = computed(
    () => this.auth.ready() && (!this.auth.isAuthenticated() || this.submitting()),
  );

  protected readonly lookup = injectQuery(() => ({
    queryKey: ['invite-lookup', this.token()],
    queryFn: async (): Promise<InviteLookup> => this.trpc.invites.lookup.query({ token: this.token() }),
    enabled: this.canLookup(),
    retry: false,
    staleTime: 0,
  }));

  // A malformed token fails input validation on the server; show it as an
  // invalid link like any unknown token.
  protected readonly invite = computed<InviteLookup | null>(() => {
    if (this.lookup.isError()) return { status: 'invalid' };
    return this.lookup.data() ?? null;
  });

  protected readonly statusTitle = computed(() => ({
    invalid: 'This link does not work',
    expired: 'This link has expired',
    used: 'This link has already been used',
    revoked: 'This link is no longer active',
  }));

  protected readonly statusDetail = computed(() => ({
    invalid:
      'Check that you copied the whole link. If it still does not work, ask the person who invited you for a new one.',
    expired: 'Ask the person who invited you for a new one.',
    used: 'An account was already created with this link. Sign in instead.',
    revoked: 'Ask the person who invited you for a new one.',
  }));

  constructor() {
    // Prefill the name the admin typed, once. The invitee can change it.
    let prefilled = false;
    effect(() => {
      const data = this.invite();
      if (prefilled || data?.status !== 'pending') return;
      prefilled = true;
      if (!this.nameControl.value) this.nameControl.setValue(data.name);
    });

    void this.auth.whenReady();
  }

  protected showError(control: FormControl<string>): boolean {
    return control.invalid && (control.touched || this.submitted());
  }

  protected showConfirmError(): boolean {
    const visible = this.confirmControl.touched || this.submitted();
    return visible && (this.confirmControl.invalid || this.form.hasError('mismatch'));
  }

  async submit(email: string) {
    if (this.submitting()) return;
    this.submitted.set(true);
    this.form.markAllAsTouched();
    if (this.form.invalid) return;

    this.submitting.set(true);
    this.submitError.set(null);
    const password = this.passwordControl.value;

    try {
      const res = await this.trpc.invites.accept.mutate({
        token: this.token(),
        name: this.nameControl.value.trim(),
        password,
      });
      email = res.email ?? email;
    } catch (err) {
      this.submitting.set(false);
      this.submitError.set(
        (err as Error)?.message || 'Something went wrong. Please try again.',
      );
      // The link may have been used or expired meanwhile; show its new state.
      void this.lookup.refetch();
      return;
    }

    const { error } = await this.auth
      .signInEmail({ email, password })
      .catch((e: unknown) => ({ error: e, data: null }));
    if (error) {
      // The account exists now; the invitee can sign in by hand.
      await this.router.navigate(['/login']);
      return;
    }
    await this.router.navigate(['/gallery']);
  }

  async signOut() {
    if (this.signingOut()) return;
    this.signingOut.set(true);
    try {
      // signOut() goes to /login; come back to this invite afterwards.
      await this.auth.signOut();
      await this.router.navigate(['/invite', this.token()]);
    } finally {
      this.signingOut.set(false);
    }
  }
}
