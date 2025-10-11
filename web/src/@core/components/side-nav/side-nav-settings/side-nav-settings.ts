import { ChangeDetectionStrategy, Component, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideActivity,
  lucideBadgeAlert,
  lucideHardDrive,
  lucideLogs,
  lucideMonitor,
  lucideUsers,
} from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIcon } from '@spartan-ng/helm/icon';

@Component({
  selector: 'app-side-nav-settings',
  imports: [HlmButton, HlmIcon, NgIcon, RouterLink, RouterLinkActive],
  providers: [
    provideIcons({
      lucideHardDrive,
      lucideLogs,
      lucideUsers,
      lucideMonitor,
      lucideBadgeAlert,
      lucideActivity,
    }),
  ],
  host: {
    class: 'flex flex-col w-full',
  },
  template: `
    <p class="mb-2 font-medium">Settings</p>

    <a
      class="mb-1"
      hlmBtn
      routerLink="/settings/ui"
      routerLinkActive="active"
      #rlaUi="routerLinkActive"
      [variant]="rlaUi.isActive ? 'menu_active' : 'menu'"
      [routerLinkActiveOptions]="{ exact: true }"
      (click)="handleClicked()"
    >
      <ng-icon hlm size="sm" name="lucideMonitor" />
      UI
    </a>

    <a
      class="mb-1"
      hlmBtn
      routerLink="/settings/users"
      routerLinkActive="active"
      #rlaUsers="routerLinkActive"
      [variant]="rlaUsers.isActive ? 'menu_active' : 'menu'"
      [routerLinkActiveOptions]="{ exact: true }"
      (click)="handleClicked()"
    >
      <ng-icon hlm size="sm" name="lucideUsers" />
      Users
    </a>

    <a
      class="mb-1"
      hlmBtn
      routerLink="/settings/sources"
      routerLinkActive="active"
      #rlaLibrary="routerLinkActive"
      [variant]="rlaLibrary.isActive ? 'menu_active' : 'menu'"
      [routerLinkActiveOptions]="{ exact: true }"
      (click)="handleClicked()"
    >
      <ng-icon hlm size="sm" name="lucideHardDrive" />
      Source Folders
    </a>

    <p class="my-2 font-medium">Advanced</p>

    <a
      class="mb-1"
      hlmBtn
      routerLink="/settings/encoding"
      routerLinkActive="active"
      #rlaEncoding="routerLinkActive"
      [variant]="rlaEncoding.isActive ? 'menu_active' : 'menu'"
      [routerLinkActiveOptions]="{ exact: true }"
      (click)="handleClicked()"
    >
      <ng-icon hlm size="sm" name="lucideActivity" />
      Encoding
    </a>

    <a
      class="mb-1"
      hlmBtn
      routerLink="/settings/logs"
      routerLinkActive="active"
      #rlaLogs="routerLinkActive"
      [variant]="rlaLogs.isActive ? 'menu_active' : 'menu'"
      [routerLinkActiveOptions]="{ exact: true }"
      (click)="handleClicked()"
    >
      <ng-icon hlm size="sm" name="lucideLogs" />
      Logs
    </a>

    <a
      class="mb-1"
      hlmBtn
      routerLink="/settings/issues"
      routerLinkActive="active"
      #rlaIssues="routerLinkActive"
      [variant]="rlaIssues.isActive ? 'menu_active' : 'menu'"
      [routerLinkActiveOptions]="{ exact: true }"
      (click)="handleClicked()"
    >
      <ng-icon hlm size="sm" name="lucideBadgeAlert" />
      Issues
    </a>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SideNavSettings {
  clicked = output<void>();

  handleClicked() {
    this.clicked.emit();
  }
}
