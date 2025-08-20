import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { SideNavDefault } from '@core/components/side-nav/side-nav-default/side-nav-default';
import { SideNavSettings } from '@core/components/side-nav/side-nav-settings/side-nav-settings';
import { ScreenSize } from '@core/services/screen-size/screen-size';
import { Sidebar } from '@core/services/sidebar/sidebar';
import { provideIcons } from '@ng-icons/core';
import { lucideCamera, lucideFilm, lucideImages, lucideLayoutDashboard } from '@ng-icons/lucide';

@Component({
  selector: 'app-side-nav',
  imports: [SideNavDefault, SideNavSettings],
  providers: [provideIcons({ lucideFilm, lucideCamera, lucideLayoutDashboard, lucideImages })],
  host: {
    class: 'flex flex-col w-full sm:w-[250px] h-full border-r p-4 overflow-y-auto',
  },
  template: `
    @switch (sideBarType()) {
      @case ('settings') {
        <app-side-nav-settings (clicked)="handleClicked()" />
      }
      @default {
        <app-side-nav-default (clicked)="handleClicked()" />
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SideNav {
  private readonly size = inject(ScreenSize);
  private readonly sidebar = inject(Sidebar);

  sideBarType = this.sidebar.content;

  handleClicked() {
    if (this.size.isMobile()) {
      this.sidebar.close();
    }
  }
}
