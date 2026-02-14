import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Theme } from '@core/services/theme/theme';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideMoon, lucideSun } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIcon } from '@spartan-ng/helm/icon';

@Component({
  selector: 'app-settings-ui',
  providers: [provideIcons({ lucideMoon, lucideSun })],
  imports: [HlmButton, NgIcon, HlmIcon],
  template: `
    <div>
      <h1 class="text-foreground mb-2 block text-lg font-bold">UI Settings</h1>
      <p class="text-muted-foreground mb-6 text-sm">Control UI preferences for your account.</p>
    </div>

    <div
      class="hover:bg-accent/50 mb-10 flex max-w-lg items-center justify-between rounded-lg border p-3"
    >
      <div class="grid gap-1.5 font-normal">
        <p class="text-sm leading-none font-bold">Dark Mode</p>
        <p class="text-muted-foreground text-sm">Toggle between light and dark theme.</p>
      </div>
      <button
        hlmBtn
        variant="ghost"
        size="icon"
        class="relative flex items-center justify-center"
        (click)="toggleTheme()"
      >
        <ng-icon
          hlm
          name="lucideMoon"
          class="text-foreground absolute transform transition-all duration-200 ease-in-out"
          [class.opacity-100]="theme.get() === 'light'"
          [class.opacity-0]="theme.get() === 'dark'"
          [class.scale-100]="theme.get() === 'light'"
          [class.scale-75]="theme.get() === 'dark'"
          [class.rotate-0]="theme.get() === 'light'"
          [class.rotate-180]="theme.get() === 'dark'"
        />

        <ng-icon
          hlm
          name="lucideSun"
          class="text-foreground absolute transform transition-all duration-200 ease-in-out"
          [class.opacity-100]="theme.get() === 'dark'"
          [class.opacity-0]="theme.get() === 'light'"
          [class.scale-100]="theme.get() === 'dark'"
          [class.scale-75]="theme.get() === 'light'"
          [class.rotate-0]="theme.get() === 'dark'"
          [class.-rotate-180]="theme.get() === 'light'"
        />
      </button>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsUi {
  protected readonly theme = inject(Theme);

  toggleTheme() {
    this.theme.toggle();
  }
}
