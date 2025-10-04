import { DatePipe, TitleCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { ErrorAlert } from '@core/components/error/error';
import { Confirm } from '@core/dialogs/confirm/confirm';
import { CreateUser } from '@core/dialogs/create-user/create-user';
import { Auth } from '@core/services/auth/auth';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc, RouterOutputs } from '@core/services/trpc';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCrown, lucidePlus, lucideTrash2, lucideUser } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCheckbox } from '@spartan-ng/helm/checkbox';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';

type User = RouterOutputs['users']['getAll'][number];

@Component({
  selector: 'app-settings-users',
  providers: [provideIcons({ lucidePlus, lucideTrash2, lucideUser, lucideCrown })],
  imports: [
    ErrorAlert,
    HlmCheckbox,
    HlmSpinner,
    HlmButton,
    HlmIcon,
    NgIcon,
    DatePipe,
    TitleCasePipe,
  ],
  host: {
    class: 'w-full',
  },
  template: `
    @if (settings.isPending() || users.isPending()) {
      <hlm-spinner />
    }

    @if (settings.isError() || users.isError()) {
      <app-error-alert [error]="settings.error() || users.error() || undefined" />
    }

    @if (settings.isSuccess() && users.isSuccess()) {
      <h1 class="text-foreground mb-2 block text-lg font-bold">User Management</h1>
      <p class="text-muted-foreground mb-6 text-sm">
        Manage user account settings and control how new users can register and access the
        application.
      </p>

      <label class="hover:bg-accent/50 mb-10 flex max-w-lg items-start gap-3 rounded-lg border p-3">
        <hlm-checkbox
          id="toggle-2"
          [checked]="allowsSelfRegistration()"
          (changed)="clickedAllowsSelfRegistration($event)"
        />
        <div class="grid gap-1.5 font-normal">
          <p class="text-sm leading-none font-bold">Allow Self‑Registration</p>
          <p class="text-muted-foreground text-sm">
            Permit users to create their own accounts without admin approval.
          </p>
        </div>
      </label>

      <div class="mb-6 flex items-center justify-between">
        <h2 class="text-foreground text-lg font-bold">Users</h2>
        <div class="flex gap-2">
          @if (isAdmin()) {
            <button hlmBtn variant="outline" (click)="openCreateUserDialog()">
              <ng-icon hlm size="sm" name="lucidePlus" />
              Add User
            </button>
          }
        </div>
      </div>

      <div class="space-y-2">
        @for (user of users.data(); track user.id) {
          <div class="flex items-center justify-between rounded-lg border p-4">
            <div class="flex items-center gap-3">
              <ng-icon hlm size="sm" name="lucideUser" />
              <div>
                <div class="flex items-center gap-2">
                  <p class="text-foreground font-medium">{{ user.name }}</p>
                  @if (user.type === 'admin') {
                    <span
                      class="flex items-center rounded-full bg-blue-500 p-1 text-white dark:bg-blue-600"
                    >
                      <ng-icon name="lucideCrown" />
                    </span>
                  }
                </div>
                <p class="text-muted-foreground text-sm">{{ user.email }}</p>
                <p class="text-muted-foreground text-xs">
                  Created {{ user.createdAt | date: 'MMM dd, yyyy' }}
                </p>
              </div>
            </div>
            <div class="flex items-center gap-2">
              @if (isAdmin() && user.id !== currentUserId()) {
                <button
                  hlmBtn
                  variant="ghost"
                  size="icon"
                  (click)="deleteUser(user.id)"
                  [disabled]="deleteUserMutation.isPending()"
                >
                  <ng-icon hlm size="sm" name="lucideTrash2" />
                </button>
              }
            </div>
          </div>
        }
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsUsers {
  private trpc = injectTrpc();
  private queryClient = inject(QueryClient);
  private dialog = inject(HlmDialogService);
  private auth = inject(Auth);

  settings = injectQuery(() => ({
    queryKey: [CacheKey.MediaSourcesSettings],
    queryFn: async () => this.trpc.settings.get.query(),
  }));

  users = injectQuery(() => ({
    queryKey: ['users'],
    queryFn: async () => this.trpc.users.getAll.query(),
  }));

  deleteUserMutation = injectMutation(() => ({
    mutationFn: (userId: string) => this.trpc.users.delete.mutate({ id: userId }),
    onSuccess: () => {
      this.queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  }));

  allowsSelfRegistration = signal(false);
  currentUserId = signal<string | null>(null);
  private currentUserType = signal<'user' | 'admin' | null>(null);

  constructor() {
    effect(() => {
      const data = this.settings.data();
      if (data) {
        this.allowsSelfRegistration.set(data.allowsSelfRegistration);
      }
    });

    // Get current user ID from auth service
    effect(() => {
      const user = this.auth.user();
      if (user) {
        this.currentUserId.set(user.id);
        this.currentUserType.set(user.type);
      }
    });
  }

  clickedAllowsSelfRegistration(checked: boolean) {
    this.trpc.settings.update.mutate({ allowsSelfRegistration: checked });
  }

  openCreateUserDialog() {
    this.dialog.open(CreateUser).closed$.subscribe((success: boolean) => {
      if (success) {
        // Dialog was closed successfully, users list will be refreshed automatically
        // by the dialog component's query invalidation
      }
    });
  }

  isAdmin(): boolean {
    return this.currentUserType() === 'admin';
  }

  deleteUser(userId: string) {
    this.dialog
      .open(Confirm, {
        context: {
          message: 'Are you sure you want to delete this user? This action cannot be undone.',
        },
      })
      .closed$.subscribe((confirmed: boolean) => {
        if (confirmed) {
          this.deleteUserMutation.mutate(userId);
        }
      });
  }
}
