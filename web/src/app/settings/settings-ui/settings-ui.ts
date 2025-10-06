import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { ErrorAlert } from '@core/components/error/error';
import { UiSettingsService } from '@core/services/ui-settings/ui-settings';
import { HlmCheckbox } from '@spartan-ng/helm/checkbox';
import { HlmSpinner } from '@spartan-ng/helm/spinner';

@Component({
  selector: 'app-settings-ui',
  imports: [HlmCheckbox, HlmSpinner, ErrorAlert],
  template: `
    @if (ui.isPending()) {
      <hlm-spinner />
    }

    @if (ui.isError()) {
      <app-error-alert [error]="ui.error() || undefined" />
    }

    @if (ui.autoCloseSidebarOnAssetOpen() !== null) {
      <h1 class="text-foreground mb-2 block text-lg font-bold">UI Settings</h1>
      <p class="text-muted-foreground mb-6 text-sm">Control UI preferences for your account.</p>

      <div class="hover:bg-accent/50 mb-10 flex max-w-lg items-start gap-3 rounded-lg border p-3">
        <hlm-checkbox
          id="toggle-auto-close-sidebar"
          [checked]="autoCloseSidebar()"
          (changed)="clickedAutoCloseSidebar($event)"
        />
        <label class="grid gap-1.5 font-normal" for="toggle-auto-close-sidebar">
          <p class="text-sm leading-none font-bold">Auto‑close sidebar on opening media</p>
          <p class="text-muted-foreground text-sm">
            When opening a photo or video, automatically collapse the left sidebar to maximize
            space.
          </p>
        </label>
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
export class SettingsUi {
  protected readonly ui = inject(UiSettingsService);

  autoCloseSidebar = signal<boolean>(true);

  constructor() {
    effect(() => {
      const value = this.ui.autoCloseSidebarOnAssetOpen();
      if (value !== null) this.autoCloseSidebar.set(value);
    });
  }

  clickedAutoCloseSidebar(checked: boolean) {
    void this.ui.setAutoCloseSidebarOnAssetOpen(checked);
  }
}
