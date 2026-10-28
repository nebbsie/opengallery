import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AlbumPicker } from '@core/components/album-picker/album-picker';
import { PeoplePicker } from '@core/components/people-picker/people-picker';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCheck, lucideCopy, lucideImages, lucideLibrary } from '@ng-icons/lucide';
import { BrnDialogRef } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import {
  HlmDialogDescription,
  HlmDialogFooter,
  HlmDialogHeader,
  HlmDialogTitle,
} from '@spartan-ng/helm/dialog';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { QueryClient } from '@tanstack/angular-query-experimental';

type Scope = 'library' | 'albums';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Invite someone with a single-use sign-up link. The admin picks the name,
// email and what the new user can see; the invitee only sets a password.
// The API returns the token once, so the link is shown right after create.
@Component({
  selector: 'app-invite-user',
  imports: [
    AlbumPicker,
    DatePipe,
    FormsModule,
    HlmButton,
    HlmDialogDescription,
    HlmDialogFooter,
    HlmDialogHeader,
    HlmDialogTitle,
    HlmIcon,
    HlmInput,
    HlmLabel,
    HlmSpinner,
    NgIcon,
    PeoplePicker,
  ],
  providers: [provideIcons({ lucideCheck, lucideCopy, lucideImages, lucideLibrary })],
  template: `
    @if (created(); as done) {
      <hlm-dialog-header>
        <h3 hlmDialogTitle>Invite link for {{ name().trim() }}</h3>
        <p hlmDialogDescription>
          Send this link to {{ firstName() }}. It works once and expires on
          {{ done.expiresAt | date: 'd MMM y' }}.
        </p>
      </hlm-dialog-header>

      <div class="space-y-3">
        <input
          hlmInput
          readonly
          class="w-full font-mono text-xs"
          [value]="done.link"
          (focus)="$any($event.target).select()"
        />
        <button hlmBtn class="w-full" size="lg" type="button" (click)="copy(done.link)">
          <ng-icon hlm size="sm" [name]="copied() ? 'lucideCheck' : 'lucideCopy'" />
          {{ copied() ? 'Copied' : 'Copy link' }}
        </button>
        <p class="text-muted-foreground text-xs">
          You will not see this link again after you close this window. If it gets lost, revoke
          the invite and make a new one.
        </p>
      </div>

      <hlm-dialog-footer class="mt-2">
        <button hlmBtn variant="outline" type="button" (click)="dialogRef.close(true)">Done</button>
      </hlm-dialog-footer>
    } @else {
      <hlm-dialog-header>
        <h3 hlmDialogTitle>Invite someone</h3>
        <p hlmDialogDescription>
          They get a link to set a password. You choose what they can see.
        </p>
      </hlm-dialog-header>

      <form class="space-y-6" (ngSubmit)="create()">
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="grid gap-2">
            <label hlmLabel for="invite-name">Name</label>
            <input
              hlmInput
              id="invite-name"
              name="name"
              autocomplete="off"
              placeholder="Sarah"
              [ngModel]="name()"
              (ngModelChange)="name.set($event)"
            />
          </div>
          <div class="grid gap-2">
            <label hlmLabel for="invite-email">Email</label>
            <input
              hlmInput
              id="invite-email"
              name="email"
              type="email"
              autocomplete="off"
              placeholder="sarah@example.com"
              [ngModel]="email()"
              (ngModelChange)="email.set($event)"
            />
          </div>
        </div>

        <section class="space-y-2">
          <h4 class="text-sm font-semibold">What can they see?</h4>
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
            <app-album-picker class="pt-2" [(selected)]="albumIds" />
          }
        </section>

        <section class="space-y-2">
          <div>
            <h4 class="text-sm font-semibold">Hide people from them</h4>
            <p class="text-muted-foreground text-xs">
              Every photo of these people disappears for {{ firstName() }}. They will not know.
              Optional.
            </p>
          </div>
          <app-people-picker [(selected)]="hiddenPersonIds" />
        </section>

        <section class="space-y-2">
          <h4 class="text-sm font-semibold">Link expires in</h4>
          <div class="flex flex-wrap gap-2">
            @for (d of expiryOptions; track d) {
              <button
                hlmBtn
                type="button"
                size="sm"
                [variant]="expiresInDays() === d ? 'default' : 'outline'"
                (click)="expiresInDays.set(d)"
              >
                {{ d === 1 ? '1 day' : d + ' days' }}
              </button>
            }
          </div>
        </section>

        @if (error()) {
          <div class="border-destructive/40 bg-destructive/10 rounded-lg border p-3">
            <p class="text-destructive text-sm">{{ error() }}</p>
          </div>
        }

        <hlm-dialog-footer>
          <button hlmBtn variant="ghost" type="button" (click)="dialogRef.close(false)">
            Cancel
          </button>
          <button hlmBtn type="submit" [disabled]="!canCreate() || saving()">
            @if (saving()) {
              <hlm-spinner class="mr-2 h-4 w-4" />
            }
            Create invite link
          </button>
        </hlm-dialog-footer>
      </form>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InviteUser {
  private readonly trpc = injectTrpc();
  private readonly queryClient = inject(QueryClient);
  protected readonly dialogRef = inject<BrnDialogRef<boolean>>(BrnDialogRef);

  protected readonly expiryOptions = [1, 3, 7, 14, 30];

  protected readonly name = signal('');
  protected readonly email = signal('');
  protected readonly scope = signal<Scope>('library');
  protected readonly albumIds = signal<string[]>([]);
  protected readonly hiddenPersonIds = signal<string[]>([]);
  protected readonly expiresInDays = signal(7);

  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly copied = signal(false);
  protected readonly created = signal<{ link: string; expiresAt: string } | null>(null);

  protected readonly firstName = computed(() => this.name().trim().split(/\s+/)[0] || 'them');

  protected readonly canCreate = computed(
    () =>
      this.name().trim().length > 0 &&
      EMAIL_RE.test(this.email().trim()) &&
      (this.scope() === 'library' || this.albumIds().length > 0),
  );

  async create() {
    if (!this.canCreate() || this.saving()) return;
    this.error.set(null);
    this.saving.set(true);
    try {
      const res = await this.trpc.invites.create.mutate({
        name: this.name().trim(),
        email: this.email().trim(),
        scope: this.scope(),
        albumIds: this.scope() === 'albums' ? this.albumIds() : [],
        hiddenPersonIds: this.hiddenPersonIds(),
        expiresInDays: this.expiresInDays(),
      });
      this.created.set({
        link: `${location.origin}/invite/${res.token}`,
        expiresAt: res.expiresAt,
      });
      this.queryClient.invalidateQueries({ queryKey: [CacheKey.Invites] });
    } catch (err) {
      // CONFLICT and "pick an album" come back as plain messages; input
      // validation errors are JSON, so those get the generic text.
      const msg = err instanceof Error ? err.message : '';
      this.error.set(
        msg && !msg.startsWith('[')
          ? msg
          : 'Could not create the invite. Check the details and try again.',
      );
    } finally {
      this.saving.set(false);
    }
  }

  async copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      // Clipboard can be blocked (e.g. plain http); the field above is
      // selectable, so the admin can still copy it by hand.
      this.copied.set(false);
    }
  }
}
