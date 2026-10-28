import { NgOptimizedImage } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Auth } from '@core/services/auth/auth';
import { injectTrpc } from '@core/services/trpc';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCrown, lucideLogOut } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { Loading } from '@core/components/loading/loading';

@Component({
  selector: 'app-settings-profile',
  providers: [provideIcons({ lucideLogOut, lucideCrown })],
  imports: [NgOptimizedImage, HlmButton, NgIcon, HlmIcon, Loading],
  // The settings shell clips overflow, so each page scrolls itself.
  host: {
    class: 'block w-full h-full min-h-0 overflow-y-auto',
  },
  template: `
    @if (auth.ready() === false) {
      <app-loading />
    } @else {
      <div>
        <h1 class="text-foreground mb-2 block text-lg font-bold">Profile</h1>
        <p class="text-muted-foreground mb-6 text-sm">
          Manage your profile and account settings.
        </p>
      </div>

      <div class="mb-6 flex max-w-lg flex-col items-center gap-6 rounded-lg border p-6">
        <img
          class="rounded-full border-b"
          [ngSrc]="avatarUrl()"
          [width]="128"
          [height]="128"
          alt="Profile image"
        />
        <div class="text-center">
          <p class="text-foreground mb-1 flex items-center justify-center gap-2 text-lg font-medium">
            {{ name() }}
            @if (type() === 'admin') {
              <span
                class="flex items-center rounded-full bg-blue-500 p-1 text-white dark:bg-blue-600"
              >
                <ng-icon name="lucideCrown" />
              </span>
            }
          </p>
          <p class="text-muted-foreground text-sm">{{ email() }}</p>
        </div>
      </div>

      <div class="flex max-w-lg gap-4">
        <button (click)="logOut()" hlmBtn variant="outline">
          <ng-icon hlm size="sm" name="lucideLogOut" />
          Sign Out
        </button>
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsProfile {
  protected readonly auth = inject(Auth);

  private readonly trpc = injectTrpc();

  // While an admin uses "View as", the session user is still the admin. Ask
  // the API who it acts as, so the preview shows the viewed user's profile.
  private readonly me = injectQuery(() => ({
    queryKey: ['users', 'me', this.auth.viewAs()?.userId ?? null],
    queryFn: async () => this.trpc.users.me.query(),
    enabled: !!this.auth.viewAs(),
  }));

  private readonly shown = computed(() => (this.auth.viewAs() ? this.me.data() : this.auth.user()));

  avatarUrl = computed(() =>
    this.auth.viewAs()
      ? 'profile_placeholder.png'
      : (this.auth.user()?.image ?? 'profile_placeholder.png'),
  );
  name = computed(() => this.shown()?.name ?? this.auth.viewAs()?.name ?? '');
  email = computed(() => this.shown()?.email ?? '');
  type = computed(() => this.shown()?.type);

  logOut() {
    this.auth.signOut();
  }
}
