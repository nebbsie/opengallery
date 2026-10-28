import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { ErrorAlert } from '@core/components/error/error';
import { injectTrpc } from '@core/services/trpc';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleCheck, lucideUserPlus } from '@ng-icons/lucide';
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCheckbox } from '@spartan-ng/helm/checkbox';
import {
  HlmDialogDescription,
  HlmDialogFooter,
  HlmDialogHeader,
  HlmDialogTitle,
} from '@spartan-ng/helm/dialog';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import {
  FileRules,
  joinNames,
  VIEWER_RULES_KEY,
  Viewer,
  viewerRulesKeys,
} from '../viewer-rules';

/**
 * What the picker hides. A person hides every photo they appear in; a file
 * hides one photo or video.
 */
export type HideFromTarget =
  | { kind: 'person'; personId: string; personName: string | null }
  | { kind: 'file'; fileId: string; fileType: 'image' | 'video' };

/**
 * Admin-only "Hide from…" picker, shared by the person page and the photo
 * viewer. Lists the non-admin users with a checkbox each; Save replaces the
 * set of users the target is hidden from. Open it with HlmDialogService and
 * pass `{ target }` as the context.
 */
@Component({
  selector: 'app-hide-from-dialog',
  providers: [provideIcons({ lucideCircleCheck, lucideUserPlus })],
  imports: [
    ErrorAlert,
    HlmButton,
    HlmCheckbox,
    HlmDialogDescription,
    HlmDialogFooter,
    HlmDialogHeader,
    HlmDialogTitle,
    HlmIcon,
    HlmSpinner,
    NgIcon,
    RouterLink,
  ],
  template: `
    <hlm-dialog-header>
      <h3 hlmDialogTitle>{{ title() }}</h3>
      <p hlmDialogDescription>{{ explanation() }}</p>
    </hlm-dialog-header>

    @if (savedMessage(); as message) {
      <div class="flex items-start gap-3 rounded-lg border p-4 text-sm">
        <ng-icon hlm size="sm" name="lucideCircleCheck" class="mt-0.5 shrink-0 text-emerald-600" />
        <p>{{ message }}</p>
      </div>
      <hlm-dialog-footer class="mt-6">
        <button hlmBtn type="button" (click)="close(true)">Done</button>
      </hlm-dialog-footer>
    } @else if (isLoading()) {
      <div class="flex items-center justify-center py-8">
        <hlm-spinner />
      </div>
    } @else if (loadError(); as error) {
      <app-error-alert [error]="error" />
    } @else if (viewers().length === 0) {
      <div class="flex flex-col items-center gap-3 rounded-lg border p-6 text-center">
        <ng-icon hlm name="lucideUserPlus" class="text-muted-foreground" />
        <p class="text-sm font-medium">Invite someone first</p>
        <p class="text-muted-foreground text-sm">
          Only you can see your library now. Invite someone, then come back here to choose what
          they cannot see.
        </p>
        <a hlmBtn size="sm" variant="outline" routerLink="/settings/users" (click)="close(false)">
          Go to Users
        </a>
      </div>
    } @else {
      <div class="max-h-80 space-y-2 overflow-y-auto pr-1">
        @for (viewer of viewers(); track viewer.id) {
          @let via = viaPerson().get(viewer.id);
          <label
            class="flex items-start gap-3 rounded-lg border p-3"
            [class]="via ? 'bg-muted/40' : 'hover:bg-accent/50 cursor-pointer'"
          >
            <hlm-checkbox
              class="mt-0.5"
              [checked]="!!via || selected().has(viewer.id)"
              [disabled]="!!via || saving()"
              (changed)="toggle(viewer.id, $event)"
            />
            <span class="grid min-w-0 gap-1">
              <span class="truncate text-sm leading-none font-semibold">{{ viewer.name }}</span>
              <span class="text-muted-foreground truncate text-sm">{{ viewer.email }}</span>
              @if (via) {
                <span class="text-muted-foreground text-xs">Already hidden: contains {{ via }}</span>
              }
            </span>
          </label>
        }
      </div>

      @if (saveError(); as error) {
        <app-error-alert class="mt-4 block" [error]="error" />
      }

      <hlm-dialog-footer class="mt-6">
        <button hlmBtn variant="ghost" type="button" [disabled]="saving()" (click)="close(false)">
          Cancel
        </button>
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
export class HideFromDialog {
  private readonly trpc = injectTrpc();
  private readonly queryClient = inject(QueryClient);
  protected readonly dialogRef = inject<BrnDialogRef<boolean>>(BrnDialogRef);
  protected readonly target = injectBrnDialogContext<{ target: HideFromTarget }>().target;

  protected readonly saving = signal(false);
  protected readonly saveError = signal<Error | undefined>(undefined);
  protected readonly savedMessage = signal<string | null>(null);
  protected readonly selected = signal<Set<string>>(new Set());

  private readonly personName =
    this.target.kind === 'person' ? this.target.personName || 'this person' : '';
  private readonly itemNoun =
    this.target.kind === 'file' && this.target.fileType === 'video' ? 'video' : 'photo';

  protected readonly title = computed(() =>
    this.target.kind === 'person'
      ? `Hide ${this.personName} from…`
      : `Hide this ${this.itemNoun} from…`,
  );

  protected readonly explanation = computed(() =>
    this.target.kind === 'person'
      ? `People you tick will not see any photo with ${this.personName} in it. They will not be told.`
      : `People you tick will not see this ${this.itemNoun}. They will not be told.`,
  );

  private readonly viewersQuery = injectQuery(() => ({
    queryKey: viewerRulesKeys.viewers(),
    queryFn: async (): Promise<Viewer[]> => this.trpc.viewerRules.viewers.query(),
  }));

  // The current rule for the target: who it is hidden from now and, for a
  // file, who cannot see it already because of a hidden person in it.
  private readonly rulesQuery = injectQuery(() => {
    const t = this.target;
    return {
      queryKey: t.kind === 'person' ? viewerRulesKeys.person(t.personId) : viewerRulesKeys.file(t.fileId),
      queryFn: async (): Promise<FileRules> =>
        t.kind === 'person'
          ? {
              ...(await this.trpc.viewerRules.forPerson.query({ personId: t.personId })),
              hiddenViaPerson: [],
            }
          : this.trpc.viewerRules.forFile.query({ fileId: t.fileId }),
    };
  });

  protected readonly viewers = computed(() => this.viewersQuery.data() ?? []);

  protected readonly isLoading = computed(
    () =>
      (this.viewersQuery.isPending() && !this.viewersQuery.data()) ||
      (this.rulesQuery.isPending() && !this.rulesQuery.data()),
  );

  protected readonly loadError = computed(
    () =>
      (this.viewersQuery.isError() ? this.viewersQuery.error() : null) ??
      (this.rulesQuery.isError() ? this.rulesQuery.error() : null) ??
      undefined,
  );

  // userId -> "Alex" or "Alex and Sam": the hidden people in this file that
  // already hide it from that user.
  protected readonly viaPerson = computed(() => {
    const byUser = new Map<string, string[]>();
    for (const row of this.rulesQuery.data()?.hiddenViaPerson ?? []) {
      const names = byUser.get(row.userId) ?? [];
      names.push(row.personName || 'a hidden person');
      byUser.set(row.userId, names);
    }
    return new Map([...byUser].map(([id, names]) => [id, joinNames([...new Set(names)])]));
  });

  constructor() {
    // Seed the ticks from the server once the current rule has loaded. Later
    // refetches do not overwrite what the admin has ticked since.
    let seeded = false;
    effect(() => {
      const data = this.rulesQuery.data();
      if (!data || seeded) return;
      seeded = true;
      this.selected.set(new Set(data.hiddenFromUserIds));
    });
  }

  toggle(userId: string, checked: boolean) {
    const next = new Set(this.selected());
    if (checked) next.add(userId);
    else next.delete(userId);
    this.selected.set(next);
  }

  async save() {
    if (this.saving()) return;
    this.saving.set(true);
    this.saveError.set(undefined);
    // Keep only users that still exist and are not hidden through a person:
    // the server stores direct rules only.
    const viaPerson = this.viaPerson();
    const userIds = this.viewers()
      .map((v) => v.id)
      .filter((id) => this.selected().has(id) && !viaPerson.has(id));
    try {
      const t = this.target;
      if (t.kind === 'person') {
        await this.trpc.viewerRules.setPersonHiddenFrom.mutate({ personId: t.personId, userIds });
      } else {
        await this.trpc.viewerRules.setFileHiddenFrom.mutate({ fileId: t.fileId, userIds });
      }
      // The admin's own lists do not change; only the rule queries do.
      await this.queryClient.invalidateQueries({ queryKey: [VIEWER_RULES_KEY] });
      this.savedMessage.set(this.confirmation(userIds));
    } catch (err) {
      this.saveError.set(err as Error);
    } finally {
      this.saving.set(false);
    }
  }

  private confirmation(userIds: string[]): string {
    const names = this.viewers()
      .filter((v) => userIds.includes(v.id))
      .map((v) => v.name);
    if (this.target.kind === 'person') {
      return names.length === 0
        ? `Saved. Photos with ${this.personName} in them are not hidden from anyone now.`
        : `Saved. ${joinNames(names)} will not see photos with ${this.personName} in them.`;
    }
    if (names.length === 0) {
      return this.viaPerson().size === 0
        ? `Saved. This ${this.itemNoun} is not hidden from anyone now.`
        : `Saved. This ${this.itemNoun} stays hidden only because of the people in it.`;
    }
    return `Saved. ${joinNames(names)} will not see this ${this.itemNoun}.`;
  }

  close(result: boolean) {
    this.dialogRef.close(result);
  }
}
