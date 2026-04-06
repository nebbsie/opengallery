import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { ErrorAlert } from '@core/components/error/error';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCheckbox } from '@spartan-ng/helm/checkbox';
import { HlmDialogFooter, HlmDialogHeader, HlmDialogTitle } from '@spartan-ng/helm/dialog';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';

@Component({
  selector: 'app-share-item',
  imports: [
    ErrorAlert,
    HlmButton,
    HlmCheckbox,
    HlmDialogFooter,
    HlmDialogHeader,
    HlmDialogTitle,
    HlmSpinner,
  ],
  template: `
    <hlm-dialog-header>
      <h3 hlmDialogTitle>Share {{ sourceLabel() }}</h3>
    </hlm-dialog-header>

    @if (shares.isPending() && !shares.data()) {
      <div class="flex items-center justify-center py-8">
        <hlm-spinner />
      </div>
    } @else if (shares.isError()) {
      <app-error-alert [error]="shares.error()" />
    } @else {
      <div class="space-y-4">
        <div>
          <p class="text-foreground text-sm font-medium">{{ title }}</p>
          <p class="text-muted-foreground text-sm">
            Select which users can view this {{ sourceLabel() }}.
          </p>
        </div>

        @if (users().length === 0) {
          <div class="text-muted-foreground rounded-lg border p-4 text-sm">
            No non-admin users are available to share with.
          </div>
        } @else {
          <div class="max-h-80 space-y-2 overflow-y-auto pr-1">
            @for (user of users(); track user.id) {
              <div class="hover:bg-accent/50 flex items-start gap-3 rounded-lg border p-3">
                <hlm-checkbox
                  [checked]="selectedUserIds().has(user.id)"
                  (changed)="toggleUser(user.id, $event)"
                />
                <div class="grid gap-1 font-normal">
                  <p class="text-sm leading-none font-bold">{{ user.name }}</p>
                  <p class="text-muted-foreground text-sm">{{ user.email }}</p>
                </div>
              </div>
            }
          </div>
        }
      </div>

      <hlm-dialog-footer class="mt-6">
        <button hlmBtn variant="ghost" type="button" (click)="close(false)">Cancel</button>
        <button hlmBtn type="button" [disabled]="saving()" (click)="save()">
          @if (saving()) {
            <hlm-spinner class="mr-2 h-4 w-4" />
          }
          Save
        </button>
      </hlm-dialog-footer>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShareItem {
  private readonly trpc = injectTrpc();
  private readonly queryClient = inject(QueryClient);
  protected readonly dialogRef = inject<BrnDialogRef<boolean>>(BrnDialogRef);
  protected readonly dialogContext = injectBrnDialogContext<{
    sourceType: 'album' | 'file';
    sourceId: string;
    title: string;
  }>();

  protected readonly saving = signal(false);
  private readonly initialSelectedUserIds = signal<string[]>([]);
  private readonly selected = signal<Set<string>>(new Set());

  protected readonly sourceType = this.dialogContext.sourceType;
  protected readonly sourceId = this.dialogContext.sourceId;
  protected readonly title = this.dialogContext.title;
  protected readonly sourceLabel = computed(() => (this.sourceType === 'album' ? 'album' : 'item'));

  protected readonly shares = injectQuery(() => ({
    queryKey: [CacheKey.AlbumSingle, 'shares', this.sourceType, this.sourceId],
    queryFn: async () =>
      this.trpc.album.getShares.query({
        sourceType: this.sourceType,
        sourceId: this.sourceId,
      }),
  }));

  protected readonly users = computed(() => this.shares.data()?.users ?? []);
  protected readonly selectedUserIds = computed(() => {
    const current = this.selected();
    if (current.size > 0 || this.initialSelectedUserIds().length === 0) {
      return current;
    }

    return new Set(this.initialSelectedUserIds());
  });

  constructor() {
    effect(() => {
      const data = this.shares.data();
      if (!data) return;
      this.initialSelectedUserIds.set(data.selectedUserIds);
      this.selected.set(new Set(data.selectedUserIds));
    });
  }

  toggleUser(userId: string, checked: boolean) {
    const next = new Set(this.selectedUserIds());
    if (checked) {
      next.add(userId);
    } else {
      next.delete(userId);
    }
    this.selected.set(next);
  }

  async save() {
    this.saving.set(true);
    try {
      await this.trpc.album.updateShares.mutate({
        sourceType: this.sourceType,
        sourceId: this.sourceId,
        userIds: [...this.selectedUserIds()],
      });
      await Promise.all([
        this.queryClient.invalidateQueries({ queryKey: [CacheKey.AlbumsAll] }),
        this.queryClient.invalidateQueries({ queryKey: [CacheKey.AlbumSingle] }),
        this.queryClient.invalidateQueries({ queryKey: [CacheKey.AssetSingle] }),
      ]);
      this.close(true);
    } finally {
      this.saving.set(false);
    }
  }

  close(result: boolean) {
    this.dialogRef.close(result);
  }
}
