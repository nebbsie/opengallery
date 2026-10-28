import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { CacheKey } from '@core/services/cache-key.types';
import { Theme, type ThemeMode } from '@core/services/theme/theme';
import { ToastService } from '@core/services/toast/toast';
import { injectTrpc } from '@core/services/trpc';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideMonitor, lucideMoon, lucideSun } from '@ng-icons/lucide';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmSwitch } from '@spartan-ng/helm/switch';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';

@Component({
  selector: 'app-settings-ui',
  providers: [provideIcons({ lucideMoon, lucideSun, lucideMonitor })],
  imports: [NgIcon, HlmIcon, HlmSwitch],
  template: `
    <div>
      <h1 class="text-foreground mb-2 block text-lg font-bold">Display</h1>
      <p class="text-muted-foreground mb-6 text-sm">Control UI preferences for your account.</p>
    </div>

    <div class="mb-4 flex max-w-lg flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
      <div class="grid gap-1.5 font-normal">
        <p id="theme-label" class="text-sm leading-none font-bold">Theme</p>
        <p class="text-muted-foreground text-sm">System follows the setting of your device.</p>
      </div>
      <div
        role="radiogroup"
        aria-labelledby="theme-label"
        class="bg-muted inline-flex shrink-0 items-center gap-1 rounded-lg p-1"
        (keydown)="onThemeKey($event)"
      >
        @for (option of themeOptions; track option.value) {
          <button
            type="button"
            role="radio"
            [attr.aria-checked]="theme.mode() === option.value"
            [attr.tabindex]="theme.mode() === option.value ? 0 : -1"
            class="flex min-h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-[background-color,color,box-shadow,scale] duration-150 active:scale-[0.96]"
            [class.bg-background]="theme.mode() === option.value"
            [class.text-foreground]="theme.mode() === option.value"
            [class.shadow-sm]="theme.mode() === option.value"
            [class.text-muted-foreground]="theme.mode() !== option.value"
            (click)="theme.set(option.value)"
          >
            <ng-icon hlm size="sm" [name]="option.icon" />
            {{ option.label }}
          </button>
        }
      </div>
    </div>

    <label
      for="show-undated"
      class="hover:bg-accent/50 mb-10 flex max-w-lg cursor-pointer items-center justify-between rounded-lg border p-3"
    >
      <div class="grid gap-1.5 font-normal">
        <p class="text-sm leading-none font-bold">Show Undated Media</p>
        <p class="text-muted-foreground text-sm">
          Show photos and videos that have no date taken. When on, they appear at the bottom of
          the gallery, photos, and videos feeds. They always appear in albums.
        </p>
      </div>
      <hlm-switch
        id="show-undated"
        [checked]="showUndated()"
        (changed)="toggleShowUndated($event)"
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
  // "Show undated" is the inverse of the stored hideUndated flag.
  protected readonly showUndated = signal(true);

  private readonly mediaSettings = injectQuery(() => ({
    queryKey: [CacheKey.MediaSourcesSettings],
    queryFn: () => this.trpc.mediaSourcesSettings.get.query(),
    staleTime: 5 * 60 * 1000,
  }));

  constructor() {
    effect(() => {
      const data = this.mediaSettings.data();
      if (data) {
        this.showUndated.set(!data.hideUndated);
      }
    });
  }

  private readonly toast = inject(ToastService);

  protected readonly themeOptions: ReadonlyArray<{ value: ThemeMode; label: string; icon: string }> = [
    { value: 'light', label: 'Light', icon: 'lucideSun' },
    { value: 'dark', label: 'Dark', icon: 'lucideMoon' },
    { value: 'system', label: 'System', icon: 'lucideMonitor' },
  ];

  // Arrow keys move the choice, as in a native radio group.
  onThemeKey(event: KeyboardEvent) {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const idx = this.themeOptions.findIndex((o) => o.value === this.theme.mode());
    const next = this.themeOptions[(idx + step + this.themeOptions.length) % this.themeOptions.length]!;
    this.theme.set(next.value);
    const buttons = (event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button');
    buttons[this.themeOptions.indexOf(next)]?.focus();
  }

  async toggleShowUndated(checked: boolean) {
    this.showUndated.set(checked);
    try {
      await this.trpc.mediaSourcesSettings.updateSettings.mutate({ hideUndated: !checked });
    } catch {
      this.showUndated.set(!checked);
      this.toast.error('Could not save the setting. Try again.');
      return;
    }
    // Refresh the cached flag too, or the effect above restores the old value
    // from cache on the next visit to this page.
    this.queryClient.invalidateQueries({ queryKey: [CacheKey.MediaSourcesSettings] });
    // Invalidate gallery, timeline and viewer prev/next so they refetch with the new filter
    this.queryClient.invalidateQueries({ queryKey: [CacheKey.AssetSingle] });
    this.queryClient.invalidateQueries({ queryKey: [CacheKey.GalleryAll] });
    this.queryClient.invalidateQueries({ queryKey: [CacheKey.GalleryPhotos] });
    this.queryClient.invalidateQueries({ queryKey: [CacheKey.GalleryVideos] });
    this.queryClient.invalidateQueries({ queryKey: [CacheKey.TimelineAll] });
    this.queryClient.invalidateQueries({ queryKey: [CacheKey.TimelinePhotos] });
    this.queryClient.invalidateQueries({ queryKey: [CacheKey.TimelineVideos] });
  }
}
