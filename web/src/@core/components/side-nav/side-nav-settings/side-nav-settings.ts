import { ChangeDetectionStrategy, Component, output } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { lucideHardDrive } from '@ng-icons/lucide';

@Component({
  selector: 'app-side-nav-settings',
  imports: [HlmButton, HlmIcon, NgIcon, RouterLink, RouterLinkActive],
  providers: [provideIcons({ lucideHardDrive })],
  host: {
    class: 'flex flex-col w-full ',
  },
  template: `
    <p class="mb-2 font-medium">Settings</p>

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
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SideNavSettings {
  clicked = output<void>();

  handleClicked() {
    this.clicked.emit();
  }
}
