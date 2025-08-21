import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { HlmDialogFooter, HlmDialogHeader, HlmDialogTitle } from '@spartan-ng/helm/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog';

@Component({
  selector: 'app-confirm',
  imports: [HlmDialogHeader, HlmDialogFooter, HlmButton, HlmDialogTitle],
  template: `
    <hlm-dialog-header>
      <h3 hlmDialogTitle>Are you sure?</h3>
    </hlm-dialog-header>

    @if (message) {
      <div class="py-2">
        <p class="text-muted-foreground">{{ message }}</p>
      </div>
    }

    <hlm-dialog-footer class="mt-4">
      <button hlmBtn variant="ghost" (click)="_dialogRef.close(false)">Cancel</button>
      <button
        hlmBtn
        [variant]="type === 'danger' ? 'destructive' : 'default'"
        type="submit"
        (click)="_dialogRef.close(true)"
      >
        Confirm
      </button>
    </hlm-dialog-footer>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Confirm {
  protected readonly _dialogRef = inject<BrnDialogRef<boolean>>(BrnDialogRef);
  protected readonly _dialogContext = injectBrnDialogContext<{
    type: 'danger';
    message?: string;
  }>();

  protected readonly message = this._dialogContext.message;
  protected readonly type = this._dialogContext.type;
}
