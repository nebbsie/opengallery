import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { EncodingStatusComponent } from '@core/components/encoding-status/encoding-status';
import { SideNavDefault } from '@core/components/side-nav/side-nav-default/side-nav-default';
import { SideNavSettings } from '@core/components/side-nav/side-nav-settings/side-nav-settings';
import { ScreenSize } from '@core/services/screen-size/screen-size';
import { Sidebar } from '@core/services/sidebar/sidebar';
import { provideIcons } from '@ng-icons/core';
import { lucideCamera, lucideFilm, lucideImages, lucideLayoutDashboard } from '@ng-icons/lucide';

@Component({
  selector: 'app-side-nav',
  imports: [SideNavDefault, SideNavSettings, EncodingStatusComponent],
  providers: [provideIcons({ lucideFilm, lucideCamera, lucideLayoutDashboard, lucideImages })],
  host: {
    class: 'flex flex-col w-full sm:w-[250px] h-full border-r p-4 overflow-y-auto',
  },
  template: `
    <div class="flex min-h-0 flex-1 flex-col">
      @switch (sideBarType()) {
        @case ('settings') {
          <app-side-nav-settings (clicked)="handleClicked()" />
        }
        @default {
          <app-side-nav-default (clicked)="handleClicked()" />
        }
      }
    </div>

    <app-encoding-status class="mt-auto pt-2" />
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
