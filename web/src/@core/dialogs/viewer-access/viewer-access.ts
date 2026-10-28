import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { ErrorAlert } from '@core/components/error/error';
import { AlbumPicker } from '@core/components/album-picker/album-picker';
import { PeoplePicker } from '@core/components/people-picker/people-picker';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideImages, lucideLibrary } from '@ng-icons/lucide';
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import {
  HlmDialogDescription,
  HlmDialogFooter,
  HlmDialogHeader,
  HlmDialogTitle,
} from '@spartan-ng/helm/dialog';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';

type Scope = 'library' | 'albums';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// "What they can see" for one non-admin user: whole library or chosen albums,
// and people hidden from them. Changes that take something away are spelled
// out in plain words before they are saved.
@Component({
  selector: 'app-viewer-access',
  imports: [
    AlbumPicker,
    ErrorAlert,
    HlmButton,
    HlmDialogDescription,
    HlmDialogFooter,
    HlmDialogHeader,
    HlmDialogTitle,
    HlmIcon,
    HlmSpinner,
    NgIcon,
    PeoplePicker,
  ],
  providers: [provideIcons({ lucideImages, lucideLibrary })],
  template: `
    <hlm-dialog-header>
      <h3 hlmDialogTitle>What {{ name }} can see</h3>
      <p hlmDialogDescription>Changes apply the next time {{ name }} opens a page.</p>
    </hlm-dialog-header>

    @if (rules.isPending()) {
      <div class="flex justify-center py-8"><hlm-spinner /></div>
    } @else if (rules.isError()) {
      <app-error-alert [error]="rules.error()" />
    } @else if (confirming()) {
      <div class="space-y-3">
        <p class="text-sm font-medium">Save these changes?</p>
        <ul class="space-y-2">
          @for (line of changes(); track line.text) {
            <li
              class="rounded-lg border p-3 text-sm"
              [class]="line.restrictive ? 'border-destructive/40 bg-destructive/5' : ''"
            >
              {{ line.text }}
            </li>
          }
        </ul>
      </div>
      <hlm-dialog-footer>
        <button hlmBtn variant="ghost" type="button" (click)="confirming.set(false)">Back</button>
        <button hlmBtn type="button" [disabled]="saving()" (click)="save()">
          @if (saving()) {
            <hlm-spinner class="mr-2 h-4 w-4" />
          }
          Yes, save
        </button>
      </hlm-dialog-footer>
    } @else {
      <div class="space-y-6">
        <section class="space-y-2">
          <h4 class="text-sm font-semibold">Photos they can see</h4>
          <div class="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              class="hover:bg-accent/50 flex items-start gap-3 rounded-lg border p-3 text-left"
              [class.border-primary]="scope() === 'library'"
              [class.ring-1]="scope() === 'library'"
              [class.ring-primary]="scope() === 'library'"
              [attr.aria-pressed]="scope() === 'library'"
              (click)="scope.set('library')"
            >
              <ng-icon hlm size="sm" name="lucideLibrary" class="mt-0.5 shrink-0" />
              <span>
                <span class="block text-sm font-medium">Everything in my library</span>
                <span class="text-muted-foreground block text-xs">
                  All photos and videos, also ones you add later.
                </span>
              </span>
            </button>
            <button
              type="button"
              class="hover:bg-accent/50 flex items-start gap-3 rounded-lg border p-3 text-left"
              [class.border-primary]="scope() === 'albums'"
              [class.ring-1]="scope() === 'albums'"
              [class.ring-primary]="scope() === 'albums'"
              [attr.aria-pressed]="scope() === 'albums'"
              (click)="scope.set('albums')"
            >
              <ng-icon hlm size="sm" name="lucideImages" class="mt-0.5 shrink-0" />
              <span>
                <span class="block text-sm font-medium">Only albums I choose</span>
                <span class="text-muted-foreground block text-xs">
                  Only the photos in the albums you pick.
                </span>
              </span>
            </button>
          </div>
          @if (scope() === 'albums') {
            <app-album-picker class="pt-2" [known]="knownAlbums()" [(selected)]="albumIds" />
          }
        </section>

        <section class="space-y-2">
          <div>
            <h4 class="text-sm font-semibold">People hidden from {{ name }}</h4>
            <p class="text-muted-foreground text-xs">
              Every photo of these people disappears for {{ name }}. They will not know.
            </p>
          </div>
          <app-people-picker [known]="knownPeople()" [(selected)]="hiddenPersonIds" />
        </section>

        <section class="text-muted-foreground rounded-lg border p-3 text-sm">
          @if (hiddenFileCount() === 0) {
            No single photos are hidden from {{ name }}.
          } @else {
            {{ hiddenFileCountText() }} hidden from {{ name }}.
          }
          To hide or show one photo, open it and use the menu in the photo viewer.
        </section>
      </div>

      @if (saveError()) {
        <p class="text-destructive text-sm">{{ saveError() }}</p>
      }

      <hlm-dialog-footer>
        <button hlmBtn variant="ghost" type="button" (click)="dialogRef.close(false)">Cancel</button>
        <button
          hlmBtn
          type="button"
          [disabled]="!dirty() || !valid() || saving()"
          (click)="review()"
        >
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
export class ViewerAccess {
  private readonly trpc = injectTrpc();
  private readonly queryClient = inject(QueryClient);
  protected readonly dialogRef = inject<BrnDialogRef<boolean>>(BrnDialogRef);
  private readonly ctx = injectBrnDialogContext<{ userId: string; name: string }>();

  protected readonly userId = this.ctx.userId;
  protected readonly name = this.ctx.name;

  protected readonly rules = injectQuery(() => ({
    queryKey: [CacheKey.ViewerRules, 'user', this.userId],
    queryFn: async () => this.trpc.viewerRules.forUser.query({ userId: this.userId }),
  }));

  protected readonly scope = signal<Scope>('library');
  protected readonly albumIds = signal<string[]>([]);
  protected readonly hiddenPersonIds = signal<string[]>([]);
  protected readonly confirming = signal(false);
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);

  protected readonly knownAlbums = computed(() => this.rules.data()?.albums ?? []);
  protected readonly knownPeople = computed(() => this.rules.data()?.hiddenPeople ?? []);
  protected readonly hiddenFileCount = computed(() => this.rules.data()?.hiddenFileIds.length ?? 0);
  protected readonly hiddenFileCountText = computed(() => {
    const n = this.hiddenFileCount();
    return n === 1 ? '1 single photo is' : `${n} single photos are`;
  });

  constructor() {
    // Seed the form once from the server; later refetches must not wipe edits.
    let seeded = false;
    effect(() => {
      const data = this.rules.data();
      if (!data || seeded) return;
      seeded = true;
      this.scope.set(data.scope);
      this.albumIds.set(data.albums.map((a) => a.id));
      this.hiddenPersonIds.set(data.hiddenPeople.map((p) => p.id));
    });
  }

  private readonly accessChanged = computed(() => {
    const data = this.rules.data();
    if (!data) return false;
    if (data.scope !== this.scope()) return true;
    if (this.scope() === 'library') return false;
    return !sameSet(
      data.albums.map((a) => a.id),
      this.albumIds(),
    );
  });

  private readonly peopleChanged = computed(() => {
    const data = this.rules.data();
    if (!data) return false;
    return !sameSet(
      data.hiddenPeople.map((p) => p.id),
      this.hiddenPersonIds(),
    );
  });

  protected readonly dirty = computed(() => this.accessChanged() || this.peopleChanged());
  protected readonly valid = computed(
    () => this.scope() === 'library' || this.albumIds().length > 0,
  );

  // Plain-words list of what the save does. "restrictive" lines take
  // something away from the user.
  protected readonly changes = computed(() => {
    const data = this.rules.data();
    const out: { text: string; restrictive: boolean }[] = [];
    if (!data) return out;
    const who = this.name;

    if (this.accessChanged()) {
      if (this.scope() === 'library') {
        out.push({ text: `${who} will see everything in your library.`, restrictive: false });
      } else if (data.scope === 'library') {
        out.push({
          text: `${who} will only see photos in ${plural(this.albumIds().length, 'album', 'albums')}, not your whole library.`,
          restrictive: true,
        });
      } else {
        const before = new Set(data.albums.map((a) => a.id));
        const after = new Set(this.albumIds());
        const removed = [...before].filter((id) => !after.has(id)).length;
        const added = [...after].filter((id) => !before.has(id)).length;
        if (removed > 0) {
          out.push({
            text: `${who} will no longer see ${plural(removed, 'album', 'albums')}.`,
            restrictive: true,
          });
        }
        if (added > 0) {
          out.push({
            text: `${who} will also see ${plural(added, 'more album', 'more albums')}.`,
            restrictive: false,
          });
        }
      }
    }

    if (this.peopleChanged()) {
      const before = new Set(data.hiddenPeople.map((p) => p.id));
      const after = new Set(this.hiddenPersonIds());
      const hidden = [...after].filter((id) => !before.has(id)).length;
      const shown = [...before].filter((id) => !after.has(id)).length;
      if (hidden > 0) {
        out.push({
          text: `${who} will no longer see photos of ${hidden === 1 ? 'this person' : `these ${hidden} people`}.`,
          restrictive: true,
        });
      }
      if (shown > 0) {
        out.push({
          text: `${who} will see photos of ${plural(shown, 'person', 'people')} again.`,
          restrictive: false,
        });
      }
    }
    return out;
  });

  review() {
    if (!this.dirty() || !this.valid()) return;
    // Only ask when something is taken away; adding access saves at once.
    if (this.changes().some((c) => c.restrictive)) {
      this.confirming.set(true);
    } else {
      void this.save();
    }
  }

  async save() {
    this.saving.set(true);
    this.saveError.set(null);
    try {
      if (this.accessChanged()) {
        await this.trpc.viewerRules.setAccess.mutate({
          userId: this.userId,
          scope: this.scope(),
          albumIds: this.scope() === 'albums' ? this.albumIds() : [],
        });
      }
      if (this.peopleChanged()) {
        await this.trpc.viewerRules.setHiddenPeopleForUser.mutate({
          userId: this.userId,
          personIds: this.hiddenPersonIds(),
        });
      }
      // Every viewer-rules view (this panel, user rows, person and photo
      // menus) shares the CacheKey.ViewerRules prefix.
      await this.queryClient.invalidateQueries({ queryKey: [CacheKey.ViewerRules] });
      this.dialogRef.close(true);
    } catch {
      this.confirming.set(false);
      this.saveError.set('Could not save. Try again.');
    } finally {
      this.saving.set(false);
    }
  }
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((x) => set.has(x));
}
