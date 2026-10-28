import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ErrorAlert } from '@core/components/error/error';
import { PluralPipe } from '@core/pipes/plural.pipe';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { ToastService } from '@core/services/toast/toast';
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCheckbox } from '@spartan-ng/helm/checkbox';
import {
  HlmDialogDescription,
  HlmDialogFooter,
  HlmDialogHeader,
  HlmDialogTitle,
} from '@spartan-ng/helm/dialog';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';

export interface BulkPeopleDialogContext {
  /** share: share with people. hide: (admin) hide from viewers. */
  mode: 'share' | 'hide';
  fileIds: string[];
}

/**
 * Pick people for many selected photos at once: share them, or (admin) hide
 * them from viewers. Adds to (or removes from) what each photo has now; it
 * does not replace the rules of each photo.
 */
@Component({
  selector: 'app-bulk-people-dialog',
  imports: [
    ErrorAlert,
    HlmButton,
    HlmCheckbox,
    HlmDialogDescription,
    HlmDialogFooter,
    HlmDialogHeader,
    HlmDialogTitle,
    HlmSpinner,
    PluralPipe,
  ],
  template: `
    <hlm-dialog-header>
      <h3 hlmDialogTitle>
        {{ isHide ? 'Hide' : 'Share' }} {{ ctx.fileIds.length | plural: 'item' }}
      </h3>
      <p hlmDialogDescription>
        @if (isHide) {
          People you tick will not see these items. They will not be told.
        } @else {
          People you tick can see these items. Items already shared stay shared.
        }
      </p>
    </hlm-dialog-header>

    @if (people.isPending() && !people.data()) {
      <div class="flex items-center justify-center py-8">
        <hlm-spinner />
      </div>
    } @else if (people.isError()) {
      <app-error-alert [error]="people.error()" />
    } @else if (list().length === 0) {
      <div class="text-muted-foreground rounded-lg border p-4 text-sm">
        There is nobody else to choose. Invite someone first.
      </div>
    } @else {
      <div class="max-h-80 space-y-2 overflow-y-auto pr-1">
        @for (user of list(); track user.id) {
          <label class="hover:bg-accent/50 flex cursor-pointer items-start gap-3 rounded-lg border p-3">
            <hlm-checkbox
              class="mt-0.5"
              [checked]="picked().has(user.id)"
              [disabled]="saving()"
              (changed)="toggle(user.id, $event)"
            />
            <span class="grid min-w-0 gap-1">
              <span class="truncate text-sm leading-none font-semibold">{{ user.name }}</span>
              @if (user.email) {
                <span class="text-muted-foreground truncate text-sm">{{ user.email }}</span>
              }
            </span>
          </label>
        }
      </div>
    }

    <hlm-dialog-footer class="mt-6 gap-2">
      <button hlmBtn variant="ghost" type="button" [disabled]="saving()" (click)="dialogRef.close(false)">
        Cancel
      </button>
      <button
        hlmBtn
        variant="outline"
        type="button"
        [disabled]="saving() || picked().size === 0"
        (click)="apply(false)"
      >
        {{ isHide ? 'Unhide' : 'Stop sharing' }}
      </button>
      <button hlmBtn type="button" [disabled]="saving() || picked().size === 0" (click)="apply(true)">
        @if (saving()) {
          <hlm-spinner class="mr-2 h-4 w-4" />
        }
        {{ isHide ? 'Hide' : 'Share' }}
      </button>
    </hlm-dialog-footer>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BulkPeopleDialog {
  private readonly trpc = injectTrpc();
  private readonly toast = inject(ToastService);
  private readonly queryClient = inject(QueryClient);
  protected readonly dialogRef = inject<BrnDialogRef<boolean>>(BrnDialogRef);
  protected readonly ctx = injectBrnDialogContext<BulkPeopleDialogContext>();
  protected readonly isHide = this.ctx.mode === 'hide';

  protected readonly saving = signal(false);
  protected readonly picked = signal<ReadonlySet<string>>(new Set());

  protected readonly people = injectQuery(() => ({
    queryKey: ['bulk-people', this.ctx.mode],
    queryFn: async (): Promise<{ id: string; name: string; email: string | null }[]> =>
      this.isHide ? this.trpc.viewerRules.viewers.query() : this.trpc.files.shareTargets.query(),
  }));

  protected readonly list = computed(() => this.people.data() ?? []);

  protected toggle(id: string, checked: boolean): void {
    const next = new Set(this.picked());
    if (checked) next.add(id);
    else next.delete(id);
    this.picked.set(next);
  }

  protected async apply(on: boolean): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    const userIds = [...this.picked()];
    const n = this.ctx.fileIds.length;
    const noun = n === 1 ? 'item' : 'items';
    try {
      if (this.isHide) {
        await this.trpc.files.bulkSetHidden.mutate({
          fileIds: this.ctx.fileIds,
          userIds,
          hidden: on,
        });
        await this.queryClient.invalidateQueries({ queryKey: [CacheKey.ViewerRules] });
        this.toast.success(on ? `Hid ${n.toLocaleString()} ${noun}` : `Unhid ${n.toLocaleString()} ${noun}`);
      } else {
        const res = await this.trpc.files.bulkShare.mutate({
          fileIds: this.ctx.fileIds,
          userIds,
          mode: on ? 'add' : 'remove',
        });
        const done = `${on ? 'Shared' : 'Stopped sharing'} ${res.count.toLocaleString()} ${res.count === 1 ? 'item' : 'items'}`;
        this.toast.success(
          res.skipped > 0 ? `${done}. ${res.skipped.toLocaleString()} not yours to share.` : done,
        );
      }
      this.dialogRef.close(true);
    } catch (err) {
      this.toast.error((err as Error)?.message || 'That did not work. Try again.');
      this.saving.set(false);
    }
  }
}
