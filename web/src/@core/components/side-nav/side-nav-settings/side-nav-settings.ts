import { ChangeDetectionStrategy, Component, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideActivity,
  lucideBadgeAlert,
  lucideHardDrive,
  lucideLogs,
  lucideMonitor,
  lucideUser,
  lucideUsers,
} from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmTooltipImports } from '@spartan-ng/helm/tooltip';
import { BrnTooltipImports } from '@spartan-ng/brain/tooltip';

@Component({
  selector: 'app-side-nav-settings',
  imports: [
    HlmButton,
    HlmIcon,
    NgIcon,
    RouterLink,
    RouterLinkActive,
    HlmTooltipImports,
    BrnTooltipImports,
  ],
  providers: [
    provideIcons({
      lucideHardDrive,
      lucideLogs,
      lucideUsers,
      lucideMonitor,
      lucideBadgeAlert,
      lucideActivity,
      lucideUser,
    }),
  ],
  host: {
    class: 'flex flex-col gap-1',
  },
  template: `
    <hlm-tooltip>
      <a
        hlmTooltipTrigger
        position="right"
        hlmBtn
        routerLink="/settings/profile"
        routerLinkActive="active"
        size="icon"
        #rlaProfile="routerLinkActive"
        [variant]="rlaProfile.isActive ? 'menu_active' : 'menu'"
        [routerLinkActiveOptions]="{ exact: true }"
        (click)="handleClicked()"
      >
        <ng-icon hlm size="sm" name="lucideUser" />
      </a>
      <span *brnTooltipContent class="flex items-center"> Profile </span>
    </hlm-tooltip>

    <hlm-tooltip>
      <a
        hlmTooltipTrigger
        position="right"
        hlmBtn
        routerLink="/settings/ui"
        routerLinkActive="active"
        size="icon"
        #rlaUi="routerLinkActive"
        [variant]="rlaUi.isActive ? 'menu_active' : 'menu'"
        [routerLinkActiveOptions]="{ exact: true }"
        (click)="handleClicked()"
      >
        <ng-icon hlm size="sm" name="lucideMonitor" />
      </a>
      <span *brnTooltipContent class="flex items-center"> UI </span>
    </hlm-tooltip>

    <hlm-tooltip>
      <a
        hlmTooltipTrigger
        position="right"
        hlmBtn
        routerLink="/settings/users"
        routerLinkActive="active"
        size="icon"
        #rlaUsers="routerLinkActive"
        [variant]="rlaUsers.isActive ? 'menu_active' : 'menu'"
        [routerLinkActiveOptions]="{ exact: true }"
        (click)="handleClicked()"
      >
        <ng-icon hlm size="sm" name="lucideUsers" />
      </a>
      <span *brnTooltipContent class="flex items-center"> Users </span>
    </hlm-tooltip>

    <hlm-tooltip>
      <a
        hlmTooltipTrigger
        position="right"
        hlmBtn
        routerLink="/settings/sources"
        routerLinkActive="active"
        size="icon"
        #rlaLibrary="routerLinkActive"
        [variant]="rlaLibrary.isActive ? 'menu_active' : 'menu'"
        [routerLinkActiveOptions]="{ exact: true }"
        (click)="handleClicked()"
      >
        <ng-icon hlm size="sm" name="lucideHardDrive" />
      </a>
      <span *brnTooltipContent class="flex items-center"> Source Folders </span>
    </hlm-tooltip>

    <hr class="my-2" />

    <hlm-tooltip>
      <a
        hlmTooltipTrigger
        position="right"
        hlmBtn
        routerLink="/settings/encoding"
        routerLinkActive="active"
        size="icon"
        #rlaEncoding="routerLinkActive"
        [variant]="rlaEncoding.isActive ? 'menu_active' : 'menu'"
        [routerLinkActiveOptions]="{ exact: true }"
        (click)="handleClicked()"
      >
        <ng-icon hlm size="sm" name="lucideActivity" />
      </a>
      <span *brnTooltipContent class="flex items-center"> Encoding </span>
    </hlm-tooltip>

    <hlm-tooltip>
      <a
        hlmTooltipTrigger
        position="right"
        hlmBtn
        routerLink="/settings/logs"
        routerLinkActive="active"
        size="icon"
        #rlaLogs="routerLinkActive"
        [variant]="rlaLogs.isActive ? 'menu_active' : 'menu'"
        [routerLinkActiveOptions]="{ exact: true }"
        (click)="handleClicked()"
      >
        <ng-icon hlm size="sm" name="lucideLogs" />
      </a>
      <span *brnTooltipContent class="flex items-center"> Logs </span>
    </hlm-tooltip>

    <hlm-tooltip>
      <a
        hlmTooltipTrigger
        position="right"
        hlmBtn
        routerLink="/settings/issues"
        routerLinkActive="active"
        size="icon"
        #rlaIssues="routerLinkActive"
        [variant]="rlaIssues.isActive ? 'menu_active' : 'menu'"
        [routerLinkActiveOptions]="{ exact: true }"
        (click)="handleClicked()"
      >
        <ng-icon hlm size="sm" name="lucideBadgeAlert" />
      </a>
      <span *brnTooltipContent class="flex items-center"> Issues </span>
    </hlm-tooltip>

    <hlm-tooltip>
      <a
        hlmTooltipTrigger
        position="right"
        hlmBtn
        routerLink="/settings/tasks"
        routerLinkActive="active"
        size="icon"
        #rlaTasks="routerLinkActive"
        [variant]="rlaTasks.isActive ? 'menu_active' : 'menu'"
        [routerLinkActiveOptions]="{ exact: true }"
        (click)="handleClicked()"
      >
        <ng-icon hlm size="sm" name="lucideBadgeAlert" />
      </a>
      <span *brnTooltipContent class="flex items-center"> Tasks </span>
    </hlm-tooltip>

    <hlm-tooltip>
      <a
        hlmTooltipTrigger
        position="right"
        hlmBtn
        routerLink="/settings/storage"
        routerLinkActive="active"
        size="icon"
        #rlaStorage="routerLinkActive"
        [variant]="rlaStorage.isActive ? 'menu_active' : 'menu'"
        [routerLinkActiveOptions]="{ exact: true }"
        (click)="handleClicked()"
      >
        <ng-icon hlm size="sm" name="lucideActivity" />
      </a>
      <span *brnTooltipContent class="flex items-center"> Storage </span>
    </hlm-tooltip>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SideNavSettings {
  clicked = output<void>();

  handleClicked() {
    this.clicked.emit();
  }
}
