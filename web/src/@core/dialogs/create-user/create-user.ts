import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { injectTrpc } from '@core/services/trpc';
import { BrnDialogRef } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogFooter, HlmDialogHeader, HlmDialogTitle } from '@spartan-ng/helm/dialog';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { QueryClient } from '@tanstack/angular-query-experimental';

@Component({
  selector: 'app-create-user',
  imports: [
    ReactiveFormsModule,
    HlmDialogHeader,
    HlmDialogTitle,
    HlmDialogFooter,
    HlmButton,
    HlmInput,
    HlmLabel,
    HlmSpinner,
  ],
  template: `
    <hlm-dialog-header>
      <h3 hlmDialogTitle>Create New User</h3>
    </hlm-dialog-header>

    <form [formGroup]="createUserForm" (ngSubmit)="createUser()" class="space-y-4">
      <div class="grid gap-2">
        <label hlmLabel for="name">Name</label>
        <input
          formControlName="name"
          hlmInput
          id="name"
          placeholder="Enter user name"
          type="text"
        />
      </div>

      <div class="grid gap-2">
        <label hlmLabel for="email">Email</label>
        <input
          formControlName="email"
          hlmInput
          id="email"
          placeholder="Enter email address"
          type="email"
        />
      </div>

      <div class="grid gap-2">
        <label hlmLabel for="password">Password</label>
        <input
          formControlName="password"
          hlmInput
          id="password"
          placeholder="Enter password"
          type="password"
        />
      </div>

      @if (error()) {
        <div class="rounded-lg border border-red-200 bg-red-50 p-3">
          <p class="text-sm text-red-800">
            Failed to create user. Please check the details and try again.
          </p>
        </div>
      }

      <hlm-dialog-footer class="mt-6">
        <button hlmBtn variant="ghost" type="button" (click)="cancel()">Cancel</button>
        <button hlmBtn type="submit" [disabled]="createUserForm.invalid || loading()">
          @if (loading()) {
            <hlm-spinner class="mr-2 h-4 w-4" />
          }
          Create User
        </button>
      </hlm-dialog-footer>
    </form>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreateUser {
  private trpc = injectTrpc();
  private queryClient = inject(QueryClient);
  protected readonly _dialogRef = inject<BrnDialogRef<boolean>>(BrnDialogRef);

  loading = signal(false);
  error = signal(false);

  createUserForm = new FormGroup({
    name: new FormControl('', [Validators.required, Validators.minLength(4)]),
    email: new FormControl('', [Validators.required, Validators.email]),
    password: new FormControl('', [Validators.required, Validators.minLength(8)]),
  });

  async createUser() {
    if (this.createUserForm.invalid) {
      return;
    }

    const formValue = this.createUserForm.value;
    if (!formValue.name || !formValue.email || !formValue.password) {
      return;
    }

    this.error.set(false);
    this.loading.set(true);

    try {
      const created = await this.trpc.users.create.mutate({
        email: formValue.email,
        password: formValue.password,
        name: formValue.name,
      });

      // Successfully created user, refresh the users list
      this.queryClient.invalidateQueries({ queryKey: ['users'] });
      this._dialogRef.close(!!created);
    } catch (error) {
      console.error('Create user failed:', error);
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  cancel() {
    this._dialogRef.close(false);
  }
}
