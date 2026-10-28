import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { ErrorAlert } from '@core/components/error/error';
import { Loading } from '@core/components/loading/loading';
import { Confirm } from '@core/dialogs/confirm/confirm';
import { CreateUser } from '@core/dialogs/create-user/create-user';
import { InviteUser } from '@core/dialogs/invite-user/invite-user';
import { ViewerAccess } from '@core/dialogs/viewer-access/viewer-access';
import { Auth } from '@core/services/auth/auth';
import { CacheKey } from '@core/services/cache-key.types';
import { optimisticEdit } from '@core/services/optimistic';
import { injectTrpc } from '@core/services/trpc';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCrown,
  lucideEye,
  lucideKeyRound,
  lucideMail,
  lucideSlidersHorizontal,
  lucideTrash2,
  lucideUserPlus,
} from '@ng-icons/lucide';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCheckbox } from '@spartan-ng/helm/checkbox';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// One line under a user's name: what they can see, in short words. Shares its
// cache entry with the "What they can see" dialog.
@Component({
  selector: 'app-viewer-summary',
  host: { class: 'text-muted-foreground text-xs' },
  template: `
    @if (rules.data()) {
      {{ text() }}
    } @else if (rules.isError()) {
      Could not load access.
    } @else {
      &nbsp;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ViewerSummary {
  private readonly trpc = injectTrpc();
  readonly userId = input.required<string>();

  protected readonly rules = injectQuery(() => ({
    queryKey: [CacheKey.ViewerRules, 'user', this.userId()],
    queryFn: async () => this.trpc.viewerRules.forUser.query({ userId: this.userId() }),
  }));

  protected readonly text = computed(() => {
    const r = this.rules.data();
    if (!r) return '';
    const parts = [
      r.scope === 'library'
        ? 'Sees everything'
        : r.albums.length === 0
          ? 'Sees nothing yet'
          : `Sees ${plural(r.albums.length, 'album', 'albums')}`,
    ];
    if (r.hiddenPeople.length > 0) {
      parts.push(`${plural(r.hiddenPeople.length, 'person', 'people')} hidden`);
    }
    if (r.hiddenFileIds.length > 0) {
      parts.push(`${plural(r.hiddenFileIds.length, 'photo', 'photos')} hidden`);
    }
    return parts.join(' · ');
  });
}

@Component({
  selector: 'app-settings-users',
  providers: [
    provideIcons({
      lucideCrown,
      lucideEye,
      lucideKeyRound,
      lucideMail,
      lucideSlidersHorizontal,
      lucideTrash2,
      lucideUserPlus,
    }),
  ],
  imports: [
    DatePipe,
    ErrorAlert,
    HlmBadge,
    HlmButton,
    HlmCheckbox,
    HlmIcon,
    Loading,
    NgIcon,
    ViewerSummary,
  ],
  host: {
    class: 'block w-full min-h-0 flex-1 overflow-y-auto pb-10',
  },
  template: `
    @if (settings.isPending() || users.isPending()) {
      <app-loading />
    }

    @if (settings.isError() || users.isError()) {
      <app-error-alert [error]="settings.error() || users.error() || undefined" />
    }

    @if (settings.isSuccess() && users.isSuccess()) {
      <div class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 class="text-foreground mb-2 block text-lg font-bold">Users</h1>
          <p class="text-muted-foreground max-w-xl text-sm">
            Invite people to your gallery and choose what each person can see.
          </p>
        </div>
        <div class="flex shrink-0 flex-wrap gap-2">
          <button hlmBtn (click)="openInviteDialog()">
            <ng-icon hlm size="sm" name="lucideUserPlus" />
            Invite someone
          </button>
          <button hlmBtn variant="outline" (click)="openCreateUserDialog()">
            <ng-icon hlm size="sm" name="lucideKeyRound" />
            Add with password
          </button>
        </div>
      </div>

      <div class="mb-10 space-y-2">
        @for (user of sortedUsers(); track user.id) {
          <div
            class="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div class="flex min-w-0 items-center gap-3">
              <span
                class="bg-muted text-foreground grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-semibold"
                aria-hidden="true"
              >
                {{ initial(user.name) }}
              </span>
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <p class="text-foreground truncate font-medium">{{ user.name }}</p>
                  @if (user.type === 'admin') {
                    <span hlmBadge variant="secondary">
                      <ng-icon name="lucideCrown" />
                      Admin
                    </span>
                  }
                  @if (user.id === currentUserId()) {
                    <span class="text-muted-foreground text-xs">(you)</span>
                  }
                </div>
                <p class="text-muted-foreground truncate text-sm">{{ user.email }}</p>
                @if (user.type === 'admin') {
                  <p class="text-muted-foreground text-xs">Sees everything</p>
                } @else {
                  <app-viewer-summary [userId]="user.id" />
                }
              </div>
            </div>

            @if (user.type !== 'admin') {
              <div class="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
                <button
                  hlmBtn
                  variant="outline"
                  size="sm"
                  (click)="openAccessDialog(user.id, user.name)"
                >
                  <ng-icon hlm size="sm" name="lucideSlidersHorizontal" />
                  What they can see
                </button>
                <button
                  hlmBtn
                  variant="ghost"
                  size="sm"
                  [disabled]="!isAdmin()"
                  (click)="viewAs(user.id, user.name)"
                >
                  <ng-icon hlm size="sm" name="lucideEye" />
                  View as {{ firstName(user.name) }}
                </button>
                <button
                  hlmBtn
                  variant="ghost"
                  size="icon"
                  [attr.aria-label]="'Delete ' + user.name"
                  [disabled]="deleteUserMutation.isPending()"
                  (click)="deleteUser(user.id, user.name)"
                >
                  <ng-icon hlm size="sm" name="lucideTrash2" />
                </button>
              </div>
            } @else if (user.id !== currentUserId()) {
              <div class="flex items-center gap-2 sm:shrink-0">
                <button
                  hlmBtn
                  variant="ghost"
                  size="icon"
                  [attr.aria-label]="'Delete ' + user.name"
                  [disabled]="deleteUserMutation.isPending()"
                  (click)="deleteUser(user.id, user.name)"
                >
                  <ng-icon hlm size="sm" name="lucideTrash2" />
                </button>
              </div>
            }
          </div>
        }
      </div>

      @if (invites.data(); as list) {
        @if (list.length > 0) {
          <div class="mb-10">
            <h2 class="text-foreground text-lg font-bold">Invites</h2>
            <p class="text-muted-foreground mb-3 text-sm">
              A link works once. You can only copy it when you create it.
            </p>
            <div class="space-y-2">
              @for (invite of list; track invite.id) {
                <div
                  class="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
                  [class.opacity-60]="invite.status !== 'pending'"
                >
                  <div class="flex min-w-0 items-center gap-3">
                    <ng-icon hlm size="sm" name="lucideMail" class="text-muted-foreground shrink-0" />
                    <div class="min-w-0">
                      <div class="flex items-center gap-2">
                        <p class="text-foreground truncate font-medium">{{ invite.name }}</p>
                        <span hlmBadge [variant]="invite.status === 'pending' ? 'default' : 'outline'">
                          {{ statusLabel(invite.status) }}
                        </span>
                      </div>
                      <p class="text-muted-foreground truncate text-sm">{{ invite.email }}</p>
                      <p class="text-muted-foreground text-xs">
                        {{ inviteScopeText(invite) }} ·
                        @switch (invite.status) {
                          @case ('pending') {
                            Expires {{ invite.expiresAt | date: 'd MMM y' }}
                          }
                          @case ('used') {
                            Joined {{ invite.usedAt | date: 'd MMM y' }}
                          }
                          @case ('expired') {
                            Expired {{ invite.expiresAt | date: 'd MMM y' }}
                          }
                          @default {
                            Sent {{ invite.createdAt | date: 'd MMM y' }}
                          }
                        }
                      </p>
                    </div>
                  </div>
                  @if (invite.status === 'pending') {
                    <button
                      hlmBtn
                      variant="outline"
                      size="sm"
                      class="self-start sm:self-auto"
                      [disabled]="revokeMutation.isPending()"
                      (click)="revokeInvite(invite.id, invite.name)"
                    >
                      Revoke
                    </button>
                  }
                </div>
              }
            </div>
          </div>
        }
      }

      <h2 class="text-foreground mb-3 text-lg font-bold">Sign-up</h2>
      <label class="hover:bg-accent/50 flex max-w-lg items-start gap-3 rounded-lg border p-3">
        <hlm-checkbox
          id="toggle-2"
          [checked]="allowsSelfRegistration()"
          (changed)="clickedAllowsSelfRegistration($event)"
        />
        <div class="grid gap-1.5 font-normal">
          <p class="text-sm leading-none font-bold">Allow self-registration</p>
          <p class="text-muted-foreground text-sm">
            Anyone who can reach this site can make an account without an invite. New accounts see
            nothing until you share with them.
          </p>
        </div>
      </label>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsUsers {
  private trpc = injectTrpc();
  private queryClient = inject(QueryClient);
  private dialog = inject(HlmDialogService);
  private auth = inject(Auth);

  protected readonly isAdmin = this.auth.isAdmin;
  protected readonly currentUserId = computed(() => this.auth.user()?.id ?? null);

  settings = injectQuery(() => ({
    queryKey: [CacheKey.SystemSettings],
    queryFn: async () => this.trpc.settings.get.query(),
  }));

  users = injectQuery(() => ({
    queryKey: [CacheKey.Users],
    queryFn: async () => this.trpc.users.getAll.query(),
  }));

  invites = injectQuery(() => ({
    queryKey: [CacheKey.Invites],
    queryFn: async () => this.trpc.invites.list.query(),
  }));

  // You first, then other admins, then everyone else by name.
  protected readonly sortedUsers = computed(() => {
    const me = this.currentUserId();
    return [...(this.users.data() ?? [])].sort((a, b) => {
      const rank = (u: { id: string; type: string }) =>
        u.id === me ? 0 : u.type === 'admin' ? 1 : 2;
      return rank(a) - rank(b) || a.name.localeCompare(b.name);
    });
  });

  // Optimistic delete: the row disappears immediately and is restored if the
  // server rejects.
  deleteUserMutation = injectMutation(() => ({
    mutationFn: (userId: string) => this.trpc.users.delete.mutate({ id: userId }),
    onMutate: async (userId) => {
      await this.queryClient.cancelQueries({ queryKey: [CacheKey.Users] });
      return optimisticEdit(this.queryClient, [
        {
          queryKey: [CacheKey.Users],
          update: (old) =>
            (old as { id: string }[] | undefined)?.filter((u) => u.id !== userId),
        },
      ]);
    },
    onError: (_err, _userId, ctx) => ctx?.rollback(),
    onSettled: () => {
      this.queryClient.invalidateQueries({ queryKey: [CacheKey.Users] });
      this.queryClient.invalidateQueries({ queryKey: [CacheKey.ViewerRules] });
    },
  }));

  revokeMutation = injectMutation(() => ({
    mutationFn: (id: string) => this.trpc.invites.revoke.mutate({ id }),
    onSettled: () => {
      this.queryClient.invalidateQueries({ queryKey: [CacheKey.Invites] });
    },
  }));

  // Optimistic toggle: the checkbox flips instantly and reverts on failure.
  private selfRegistrationMutation = injectMutation(() => ({
    mutationFn: (checked: boolean) =>
      this.trpc.settings.update.mutate({ allowsSelfRegistration: checked }),
    onMutate: (checked) => {
      const prev = this.allowsSelfRegistration();
      this.allowsSelfRegistration.set(checked);
      return { prev };
    },
    onError: (_err, _checked, ctx) => this.allowsSelfRegistration.set(ctx?.prev ?? false),
    onSettled: () => {
      this.queryClient.invalidateQueries({ queryKey: [CacheKey.SystemSettings] });
    },
  }));

  allowsSelfRegistration = signal(false);

  constructor() {
    effect(() => {
      const data = this.settings.data();
      if (data) {
        this.allowsSelfRegistration.set(data.allowsSelfRegistration);
      }
    });
  }

  protected initial(name: string) {
    return (name.trim()[0] ?? '?').toUpperCase();
  }

  protected firstName(name: string) {
    return name.trim().split(/\s+/)[0] || name;
  }

  protected statusLabel(status: 'pending' | 'used' | 'expired' | 'revoked') {
    switch (status) {
      case 'pending':
        return 'Waiting';
      case 'used':
        return 'Joined';
      case 'expired':
        return 'Expired';
      case 'revoked':
        return 'Revoked';
    }
  }

  protected inviteScopeText(invite: {
    scope: string;
    albumCount: number;
    hiddenPeopleCount: number;
  }) {
    const sees =
      invite.scope === 'library'
        ? 'Everything'
        : plural(invite.albumCount, 'album', 'albums');
    return invite.hiddenPeopleCount > 0
      ? `${sees}, ${plural(invite.hiddenPeopleCount, 'person', 'people')} hidden`
      : sees;
  }

  clickedAllowsSelfRegistration(checked: boolean) {
    this.selfRegistrationMutation.mutate(checked);
  }

  openInviteDialog() {
    this.dialog.open(InviteUser, {
      contentClass: 'sm:max-w-[680px] max-h-[90dvh] overflow-y-auto',
    });
  }

  openCreateUserDialog() {
    // The dialog invalidates the users list itself.
    this.dialog.open(CreateUser);
  }

  openAccessDialog(userId: string, name: string) {
    this.dialog.open(ViewerAccess, {
      context: { userId, name },
      contentClass: 'sm:max-w-[680px] max-h-[90dvh] overflow-y-auto',
    });
  }

  viewAs(userId: string, name: string) {
    this.auth.startViewAs({ userId, name });
  }

  deleteUser(userId: string, name: string) {
    this.dialog
      .open(Confirm, {
        context: {
          type: 'danger',
          message: `Delete ${name}'s account? ${name} can no longer sign in. This cannot be undone.`,
        },
      })
      .closed$.subscribe((confirmed: boolean) => {
        if (confirmed) {
          this.deleteUserMutation.mutate(userId);
        }
      });
  }

  revokeInvite(id: string, name: string) {
    this.dialog
      .open(Confirm, {
        context: {
          type: 'danger',
          message: `Revoke the invite for ${name}? The link stops working right away.`,
        },
      })
      .closed$.subscribe((confirmed: boolean) => {
        if (confirmed) {
          this.revokeMutation.mutate(id);
        }
      });
  }
}
