import { Component, inject } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideX } from '@ng-icons/lucide';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { ToastService } from '@core/services/toast/toast';

@Component({
  selector: 'app-toaster',
  providers: [provideIcons({ lucideX })],
  imports: [NgIcon, HlmIcon],
  template: `
    <div
      aria-live="polite"
      class="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[100] flex flex-col items-center gap-2 px-4 sm:bottom-6"
    >
      @for (t of toasts.toasts(); track t.id) {
        <div
          role="status"
          class="bg-popover text-popover-foreground pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-lg border py-2 pr-2 pl-4 text-sm shadow-lg"
          [class.border-destructive]="t.kind === 'error'"
        >
          <p class="min-w-0 flex-1">{{ t.message }}</p>
          @if (t.action) {
            <button
              type="button"
              class="text-primary hover:bg-accent shrink-0 rounded-md px-3 py-2 font-medium"
              (click)="toasts.runAction(t)"
            >
              {{ t.action.label }}
            </button>
          }
          <button
            type="button"
            aria-label="Dismiss"
            class="text-muted-foreground hover:bg-accent shrink-0 rounded-md p-2"
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
}
