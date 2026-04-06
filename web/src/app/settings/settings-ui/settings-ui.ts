import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { CacheKey } from '@core/services/cache-key.types';
import { Theme } from '@core/services/theme/theme';
import { injectTrpc } from '@core/services/trpc';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideMoon, lucideSun } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmSwitch } from '@spartan-ng/helm/switch';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';

@Component({
  selector: 'app-settings-ui',
  providers: [provideIcons({ lucideMoon, lucideSun })],
  imports: [HlmButton, NgIcon, HlmIcon, HlmSwitch],
  template: `
    <div>
      <h1 class="text-foreground mb-2 block text-lg font-bold">UI Settings</h1>
      <p class="text-muted-foreground mb-6 text-sm">Control UI preferences for your account.</p>
    </div>

    <div
      class="hover:bg-accent/50 mb-4 flex max-w-lg items-center justify-between rounded-lg border p-3"
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

    <label
      for="hide-undated"
      class="hover:bg-accent/50 mb-10 flex max-w-lg cursor-pointer items-center justify-between rounded-lg border p-3"
    >
      <div class="grid gap-1.5 font-normal">
        <p class="text-sm leading-none font-bold">Hide Undated Media</p>
        <p class="text-muted-foreground text-sm">
          Hide photos and videos without a date taken from the gallery, photos, and videos feeds.
          They will still appear in albums.
        </p>
      </div>
      <hlm-switch
        id="hide-undated"
        [checked]="hideUndated()"
        (changed)="toggleHideUndated($event)"
      />
    </label>
  `,
  styles: `
    :host {
      display: block;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsUi {
  private readonly trpc = injectTrpc();
  private readonly queryClient = inject(QueryClient);
  protected readonly theme = inject(Theme);
  protected readonly hideUndated = signal(false);

  private readonly mediaSettings = injectQuery(() => ({
    queryKey: [CacheKey.MediaSourcesSettings],
    queryFn: () => this.trpc.mediaSourcesSettings.get.query(),
    staleTime: 5 * 60 * 1000,
  }));

  constructor() {
    effect(() => {
      const data = this.mediaSettings.data();
      if (data) {
        this.hideUndated.set(data.hideUndated);
      }
    });
  }

  toggleTheme() {
    this.theme.toggle();
  }

  async toggleHideUndated(checked: boolean) {
    this.hideUndated.set(checked);
    await this.trpc.mediaSourcesSettings.updateSettings.mutate({ hideUndated: checked });
    // Invalidate gallery and timeline queries so they refetch with the new filter
    this.queryClient.invalidateQueries({ queryKey: [CacheKey.GalleryAll] });
    this.queryClient.invalidateQueries({ queryKey: [CacheKey.GalleryPhotos] });
    this.queryClient.invalidateQueries({ queryKey: [CacheKey.GalleryVideos] });
    this.queryClient.invalidateQueries({ queryKey: [CacheKey.TimelineAll] });
    this.queryClient.invalidateQueries({ queryKey: [CacheKey.TimelinePhotos] });
    this.queryClient.invalidateQueries({ queryKey: [CacheKey.TimelineVideos] });
  }
}
