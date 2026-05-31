import { ChangeDetectionStrategy, Component, computed, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { injectTrpc } from '@core/services/trpc';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideActivity,
  lucideBadgeAlert,
  lucideHardDrive,
  lucideListChecks,
  lucideLogs,
  lucideMapPin,
  lucideMonitor,
  lucideUser,
  lucideUsers,
} from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmTooltipImports } from '@spartan-ng/helm/tooltip';
import { BrnTooltipImports } from '@spartan-ng/brain/tooltip';
import { injectQuery } from '@tanstack/angular-query-experimental';

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
      lucideListChecks,
      lucideActivity,
      lucideUser,
      lucideMapPin,
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
        routerLink="/settings/faces"
        routerLinkActive="active"
        size="icon"
        #rlaFaces="routerLinkActive"
        [variant]="rlaFaces.isActive ? 'menu_active' : 'menu'"
        [routerLinkActiveOptions]="{ exact: true }"
        (click)="handleClicked()"
      >
        <ng-icon hlm size="sm" name="lucideUsers" />
      </a>
      <span *brnTooltipContent class="flex items-center"> Faces </span>
    </hlm-tooltip>

    <hlm-tooltip>
      <a
        hlmTooltipTrigger
        position="right"
        hlmBtn
        routerLink="/settings/locations"
        routerLinkActive="active"
        size="icon"
        #rlaLocations="routerLinkActive"
        [variant]="rlaLocations.isActive ? 'menu_active' : 'menu'"
        [routerLinkActiveOptions]="{ exact: true }"
        (click)="handleClicked()"
      >
        <ng-icon hlm size="sm" name="lucideMapPin" />
      </a>
      <span *brnTooltipContent class="flex items-center"> Locations </span>
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
        <div class="relative">
          <ng-icon hlm size="sm" name="lucideListChecks" />
          @if (pendingCount() > 0) {
            <span class="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-[9px] font-bold text-white">
              {{ pendingCount() > 99 ? '99+' : pendingCount() }}
            </span>
          }
        </div>
      </a>
      <span *brnTooltipContent class="flex items-center">
        Tasks @if (pendingCount() > 0) { ({{ pendingCount() }} pending) }
      </span>
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

  private readonly trpc = injectTrpc();

  private readonly queueCounts = injectQuery(() => ({
    queryKey: ['queue', 'encodingCounts'],
    queryFn: () => this.trpc.queue.encodingCounts.query(),
    refetchInterval: 10_000,
  }));

  pendingCount = computed(() => this.queueCounts.data()?.totalPending ?? 0);

  handleClicked() {
    this.clicked.emit();
  }
}
