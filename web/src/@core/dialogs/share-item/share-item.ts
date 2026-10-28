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
import { HlmSwitch } from '@spartan-ng/helm/switch';
import { ToastService } from '@core/services/toast/toast';
import {
  HlmDialogDescription,
  HlmDialogFooter,
  HlmDialogHeader,
  HlmDialogTitle,
} from '@spartan-ng/helm/dialog';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';

@Component({
  selector: 'app-share-item',
  imports: [
    ErrorAlert,
    HlmButton,
    HlmSwitch,
    HlmDialogDescription,
    HlmDialogFooter,
    HlmDialogHeader,
    HlmDialogTitle,
    HlmSpinner,
  ],
  template: `
    <hlm-dialog-header>
      <h3 hlmDialogTitle>Share this {{ sourceLabel() }}</h3>
      <p hlmDialogDescription>
        People you turn on can see {{ title || 'this ' + sourceLabel() }}{{
          sourceType === 'album' ? ' and every photo in it' : ''
        }}. Turn someone off to stop sharing with them.
      </p>
    </hlm-dialog-header>

    @if (shares.isPending() && !shares.data()) {
      <div class="flex items-center justify-center py-8">
        <hlm-spinner />
      </div>
    } @else if (shares.isError()) {
      <app-error-alert [error]="shares.error()" />
    } @else {
      @if (users().length === 0) {
        <div class="text-muted-foreground rounded-lg border p-4 text-sm">
          There is nobody to share with yet. Invite someone in Settings, Users.
        </div>
      } @else {
        <ul class="max-h-80 space-y-2 overflow-y-auto pr-1" aria-label="People">
          @for (user of users(); track user.id) {
            @let on = selectedUserIds().has(user.id);
            <li>
              <label
                [for]="'share-' + user.id"
                class="flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors"
                [class]="on ? 'border-primary/40 bg-primary/5' : 'hover:bg-accent/50'"
              >
                <span class="grid min-w-0 flex-1 gap-1">
                  <span class="truncate text-sm leading-none font-semibold">{{ user.name }}</span>
                  <span class="text-muted-foreground truncate text-sm">{{ user.email }}</span>
                </span>
                <span
                  class="w-16 shrink-0 text-right text-xs font-medium"
                  [class.text-foreground]="on"
                  [class.text-muted-foreground]="!on"
                  aria-hidden="true"
                >
                  {{ on ? 'Can see' : 'No access' }}
                </span>
                <hlm-switch
                  [id]="'share-' + user.id"
                  [checked]="on"
                  [disabled]="saving()"
                  [aria-label]="user.name + (on ? ', can see' : ', no access')"
                  (changed)="toggleUser(user.id, $event)"
                />
              </label>
            </li>
          }
        </ul>
      }

      <hlm-dialog-footer class="mt-6">
        <button hlmBtn variant="ghost" type="button" [disabled]="saving()" (click)="close(false)">Cancel</button>
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
  private readonly toast = inject(ToastService);
  protected readonly dialogRef = inject<BrnDialogRef<boolean>>(BrnDialogRef);
  protected readonly dialogContext = injectBrnDialogContext<{
    sourceType: 'album' | 'file';
    sourceId: string;
    title: string;
  }>();

  protected readonly saving = signal(false);
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
  // Seeded from the server by the effect below; an empty set means "share with nobody".
  protected readonly selectedUserIds = computed(() => this.selected());

  constructor() {
    effect(() => {
      const data = this.shares.data();
      if (!data) return;
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
    if (this.saving()) return;
    this.saving.set(true);
    const userIds = [...this.selectedUserIds()];
    try {
      await this.trpc.album.updateShares.mutate({
        sourceType: this.sourceType,
        sourceId: this.sourceId,
        userIds,
      });
    } catch {
      this.saving.set(false);
      this.toast.error('Could not save sharing. Try again.');
      return;
    }
    // Refresh in the background; a failed refresh does not undo the save.
    void Promise.all([
      this.queryClient.invalidateQueries({ queryKey: [CacheKey.AlbumsAll] }),
      this.queryClient.invalidateQueries({ queryKey: [CacheKey.AlbumSingle] }),
      this.queryClient.invalidateQueries({ queryKey: [CacheKey.AssetSingle] }),
    ]).catch(() => undefined);
    this.saving.set(false);
    const names = this.users()
      .filter((u) => userIds.includes(u.id))
      .map((u) => u.name);
    this.toast.success(
      names.length === 0
        ? `This ${this.sourceLabel()} is not shared with anyone now`
        : `Shared with ${joinList(names)}`,
    );
    this.close(true);
  }

  close(result: boolean) {
    this.dialogRef.close(result);
  }
}

function joinList(names: string[]): string {
  if (names.length <= 2) return names.join(' and ');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
