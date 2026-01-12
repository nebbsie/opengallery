import { ChangeDetectionStrategy, Component } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideLoader } from '@ng-icons/lucide';
import { HlmIcon } from '@spartan-ng/helm/icon';

@Component({
  selector: 'app-loading-thumbnail',
  standalone: true,
  imports: [NgIcon, HlmIcon],
  providers: [provideIcons({ lucideLoader })],
  host: {
    class: 'relative aspect-square overflow-hidden rounded-lg bg-black',
  },
  template: `
    <div
      class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[var(--secondary)] ring-1 ring-[var(--border)]"
    >
      <ng-icon hlm name="lucideLoader" class="size-6 animate-spin text-[var(--muted-foreground)]" />
      <span class="text-xs text-[var(--muted-foreground)]">Importing...</span>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoadingThumbnail {}
