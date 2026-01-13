import { NgOptimizedImage } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Auth } from '@core/services/auth/auth';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCrown, lucideLogOut } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmSpinner } from '@spartan-ng/helm/spinner';

@Component({
  selector: 'app-settings-profile',
  providers: [provideIcons({ lucideLogOut, lucideCrown })],
  imports: [NgOptimizedImage, HlmButton, NgIcon, HlmIcon, HlmSpinner],
  host: {
    class: 'w-full',
  },
  template: `
    @if (auth.ready() === false) {
      <hlm-spinner />
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

  avatarUrl = computed(() => this.auth.user()?.image ?? 'profile_placeholder.png');
  name = computed(() => this.auth.user()?.name ?? '');
  email = computed(() => this.auth.user()?.email ?? '');
  type = computed(() => this.auth.user()?.type);

  logOut() {
    this.auth.signOut();
  }
}
