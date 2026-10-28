import { Component, inject } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideX } from '@ng-icons/lucide';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { ToastService } from '@core/services/toast/toast';
import { UploadService } from '@core/services/upload/upload';

@Component({
  selector: 'app-toaster',
  providers: [provideIcons({ lucideX })],
  imports: [NgIcon, HlmIcon],
  template: `
    <div
      aria-live="polite"
      class="pointer-events-none fixed inset-x-0 z-[100] flex flex-col items-center gap-2 px-4"
      [class]="
        uploads.panelOpen()
          ? 'top-[calc(env(safe-area-inset-top)+0.75rem)]'
          : 'bottom-[calc(5rem+env(safe-area-inset-bottom))] sm:bottom-6'
      "
    >
      @for (t of toasts.toasts(); track t.id) {
        <div
          role="status"
          class="glass-strong text-popover-foreground pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl py-2 pr-2 pl-4 text-sm"
          [class.!border-destructive]="t.kind === 'error'"
        >
          <p class="min-w-0 flex-1">{{ t.message }}</p>
          @if (t.action) {
            <button
              type="button"
              class="text-primary hover:bg-glass-tint shrink-0 rounded-lg px-3 py-2 font-medium"
              (click)="toasts.runAction(t)"
            >
              {{ t.action.label }}
            </button>
          }
          <button
            type="button"
            aria-label="Dismiss"
            class="text-muted-foreground hover:bg-glass-tint shrink-0 rounded-lg p-2"
            (click)="toasts.dismiss(t.id)"
          >
            <ng-icon hlm size="sm" name="lucideX" />
          </button>
        </div>
      }
    </div>
  `,
})
export class Toaster {
  protected readonly toasts = inject(ToastService);
  // The upload panel sits at the bottom, so toasts move to the top while it is
  // open instead of covering it.
  protected readonly uploads = inject(UploadService);
}
