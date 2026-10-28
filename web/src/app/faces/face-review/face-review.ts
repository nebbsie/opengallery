import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  DOCUMENT,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { CdkTrapFocus } from '@angular/cdk/a11y';
import { isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import { CacheKey } from '@core/services/cache-key.types';
import { ToastService } from '@core/services/toast/toast';
import { injectTrpc, RouterOutputs } from '@core/services/trpc';
import { environment } from '@env/environment';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCheck, lucideSkipForward, lucideUndo2, lucideX } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { FaceActions, faceAlt } from '../face-actions';

export type ReviewItem = RouterOutputs['faces']['listConfirmCandidates'][number];
type Verdict = 'yes' | 'no' | 'skip';

// How many review items one session loads. The banner and the People page
// entry use the same key and limit, so they share one cache entry.
export const REVIEW_LIMIT = 50;

export function reviewQueryKey(personId: string | null) {
  return [CacheKey.FaceReview, personId ?? 'all'] as const;
}

// Text for a count that may be capped by REVIEW_LIMIT.
export function reviewCountText(n: number): string {
  return n >= REVIEW_LIMIT ? `${REVIEW_LIMIT}+` : `${n}`;
}

// "Is this <name>?" review, one face at a time (Google Photos style).
// Full-screen panel; keys Y / N / S answer, U or Ctrl+Z undoes, Escape closes.
@Component({
  selector: 'app-face-review',
  imports: [NgIcon, HlmIcon, HlmButton, HlmSpinner, RouterLink],
  hostDirectives: [CdkTrapFocus],
  providers: [provideIcons({ lucideCheck, lucideSkipForward, lucideUndo2, lucideX })],
  host: {
    class: 'fixed inset-0 z-50 flex flex-col bg-background',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'face-review-title',
  },
  template: `
    <header class="flex items-center gap-3 border-b px-4 py-2">
      <button
        hlmBtn
        variant="ghost"
        size="icon"
        class="size-11 active:scale-[0.96]"
        aria-label="Close review"
        (click)="close()"
      >
        <ng-icon hlm name="lucideX" />
      </button>
      <h2 id="face-review-title" class="text-foreground text-base font-semibold">
        Review faces
      </h2>
      @if (queue().length > 0) {
        <span class="text-muted-foreground ml-auto text-sm tabular-nums" aria-live="polite">
          {{ progressIndex() }} of {{ queue().length }}
        </span>
      }
    </header>
    @if (queue().length > 0) {
      <div
        class="bg-muted h-1 w-full"
        role="progressbar"
        aria-label="Review progress"
        [attr.aria-valuenow]="index()"
        aria-valuemin="0"
        [attr.aria-valuemax]="queue().length"
      >
        <div
          class="bg-primary h-full transition-[width] duration-200"
          [style.width.%]="(index() / queue().length) * 100"
        ></div>
      </div>
    }

    <main class="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 overflow-y-auto p-6">
      @if (!started() && candidates.isPending()) {
        <hlm-spinner />
      } @else if (current(); as item) {
        <p class="text-foreground text-center text-2xl font-semibold text-balance">
          Is this {{ item.personName || 'the same person' }}?
        </p>

        <div class="flex items-end gap-4">
          <img
            class="bg-muted size-56 rounded-full object-cover outline outline-1 -outline-offset-1 outline-black/10 sm:size-64 dark:outline-white/10"
            [src]="faceUrl(item.faceId)"
            [alt]="faceAlt(item.personName)"
          />
          <a
            class="focus-visible:ring-ring block size-24 shrink-0 overflow-hidden rounded-lg outline outline-1 -outline-offset-1 outline-black/10 focus-visible:ring-2 dark:outline-white/10"
            [routerLink]="['/asset', item.fileId]"
            target="_blank"
            aria-label="Open the full photo in a new tab"
          >
            <img
              class="bg-muted h-full w-full object-cover"
              [src]="thumbUrl(item.fileId)"
              alt="The photo this face is in"
            />
          </a>
        </div>

        <!-- Preload the next crop so the next answer shows at once. A hidden
             img, not <link rel=preload>: Angular blocks bound URLs on <link>. -->
        @if (next(); as n) {
          <img class="hidden" alt="" aria-hidden="true" [src]="faceUrl(n.faceId)" />
        }

        <div class="flex flex-wrap items-center justify-center gap-3">
          <button
            hlmBtn
            size="lg"
            class="h-12 min-w-28 active:scale-[0.96]"
            aria-keyshortcuts="Y"
            (click)="answer('yes')"
          >
            <ng-icon hlm size="sm" name="lucideCheck" />
            Yes
            <kbd class="ml-1 rounded border border-current/30 px-1 text-xs opacity-70">Y</kbd>
          </button>
          <button
            hlmBtn
            size="lg"
            variant="outline"
            class="h-12 min-w-28 active:scale-[0.96]"
            aria-keyshortcuts="N"
            (click)="answer('no')"
          >
            <ng-icon hlm size="sm" name="lucideX" />
            No
            <kbd class="ml-1 rounded border px-1 text-xs opacity-70">N</kbd>
          </button>
          <button
            hlmBtn
            size="lg"
            variant="ghost"
            class="h-12 min-w-28 active:scale-[0.96]"
            aria-keyshortcuts="S"
            (click)="answer('skip')"
          >
            <ng-icon hlm size="sm" name="lucideSkipForward" />
            Skip
            <kbd class="ml-1 rounded border px-1 text-xs opacity-70">S</kbd>
          </button>
        </div>
      } @else {
        <div class="flex flex-col items-center gap-3 text-center">
          <span class="bg-primary/10 text-primary grid size-16 place-items-center rounded-full">
            <ng-icon hlm size="lg" name="lucideCheck" />
          </span>
          <p class="text-foreground text-xl font-semibold">
            {{ queue().length > 0 ? 'All done' : 'Nothing to review' }}
          </p>
          <p class="text-muted-foreground max-w-xs text-sm text-pretty">
            @if (queue().length > 0) {
              You answered {{ answered() }} of {{ queue().length }}. Your answers keep these faces
              where you put them when faces are grouped again.
            } @else {
              Faces show here when the app is not sure who they are.
            }
          </p>
          <div class="flex gap-2">
            @if (queue().length > 0) {
              <button hlmBtn variant="outline" class="h-11 active:scale-[0.96]" (click)="reload()">
                Check for more
              </button>
            }
            <button hlmBtn class="h-11 active:scale-[0.96]" (click)="close()">Close</button>
          </div>
        </div>
      }
    </main>

    <footer class="flex min-h-14 items-center justify-center border-t px-4 py-2">
      @if (history().length > 0) {
        <button
          hlmBtn
          variant="ghost"
          class="h-11 active:scale-[0.96]"
          aria-keyshortcuts="U Control+Z Meta+Z"
          (click)="undo()"
        >
          <ng-icon hlm size="sm" name="lucideUndo2" />
          Undo last answer
        </button>
      } @else {
        <p class="text-muted-foreground text-xs">Keys: Y yes, N no, S skip, U undo, Esc close</p>
      }
    </footer>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FaceReview {
  // null reviews faces across every named person.
  readonly personId = input<string | null>(null);
  readonly closed = output<void>();

  private readonly trpc = injectTrpc();
  private readonly actions = inject(FaceActions);
  private readonly toast = inject(ToastService);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly apiUrl = environment.api.url;
  protected readonly faceAlt = faceAlt;

  protected readonly candidates = injectQuery(() => ({
    queryKey: reviewQueryKey(this.personId()),
    queryFn: async () =>
      this.trpc.faces.listConfirmCandidates.query({
        personId: this.personId() ?? undefined,
        limit: REVIEW_LIMIT,
      }),
  }));

  // A snapshot of the queue taken when the session starts, so a background
  // refetch does not move the face under the user's cursor.
  private readonly snapshot = signal<ReviewItem[] | null>(null);
  protected readonly started = computed(() => this.snapshot() !== null);
  protected readonly queue = computed(
    () => this.snapshot() ?? ((this.candidates.data() ?? []) as ReviewItem[]),
  );
  protected readonly index = signal(0);
  // token resolves to the server's undo token for a Yes or No (null for a Skip
  // or a failed save).
  protected readonly history = signal<
    { item: ReviewItem; verdict: Verdict; token: Promise<string | null> }[]
  >([]);
  private changed = false;

  protected readonly current = computed(() => this.queue()[this.index()] ?? null);
  protected readonly next = computed(() => this.queue()[this.index() + 1] ?? null);
  protected readonly progressIndex = computed(() =>
    Math.min(this.index() + 1, this.queue().length),
  );
  protected readonly answered = computed(
    () => this.history().filter((h) => h.verdict !== 'skip').length,
  );

  constructor() {
    // Capture-phase listener on document: runs before the page's
    // back-on-Escape handler, so Escape closes this panel only.
    // Focus stays inside the panel (CdkTrapFocus) and goes back to the
    // element that opened it on close.
    if (isPlatformBrowser(inject(PLATFORM_ID))) {
      const doc = inject(DOCUMENT);
      const opener = doc.activeElement as HTMLElement | null;
      const onKey = (e: KeyboardEvent) => this.onKey(e);
      doc.addEventListener('keydown', onKey, true);
      inject(DestroyRef).onDestroy(() => {
        doc.removeEventListener('keydown', onKey, true);
        if (opener?.isConnected) opener.focus();
      });
    }
    afterNextRender(() => this.host.nativeElement.querySelector('button')?.focus());
  }

  private onKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    const key = e.key.toLowerCase();
    if (key === 'escape') {
      e.preventDefault();
      e.stopPropagation();
      this.close();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && key === 'z') {
      e.preventDefault();
      this.undo();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (key === 'u') {
      e.preventDefault();
      this.undo();
      return;
    }
    if (!this.current()) return;
    const verdict: Verdict | null =
      key === 'y' ? 'yes' : key === 'n' ? 'no' : key === 's' ? 'skip' : null;
    if (verdict) {
      e.preventDefault();
      this.answer(verdict);
    }
  }

  protected answer(verdict: Verdict): void {
    const item = this.current();
    if (!item) return;
    if (!this.snapshot()) this.snapshot.set(this.queue());
    this.index.update((i) => i + 1);
    if (verdict === 'skip') {
      this.history.update((h) => [...h, { item, verdict, token: Promise.resolve(null) }]);
      return;
    }
    this.changed = true;
    // Fire and forget so the next face shows at once; a failure says so and
    // steps back to the face that failed.
    const token = this.trpc.faces.confirmFace
      .mutate({ faceId: item.faceId, personId: item.personId, verdict })
      .then((r) => r.undoToken)
      .catch(() => {
        this.toast.error('That answer did not save. Try it again.');
        this.history.update((h) => h.filter((x) => x.item !== item));
        const at = this.queue().indexOf(item);
        if (at >= 0 && at < this.index()) this.index.set(at);
        return null;
      });
    this.history.update((h) => [...h, { item, verdict, token }]);
  }

  // Step back to the last answered face. The server's undo token puts the
  // face, its answers and its person back as they were before a Yes or No.
  protected undo(): void {
    const last = this.history().at(-1);
    if (!last) return;
    this.history.update((h) => h.slice(0, -1));
    const at = this.queue().indexOf(last.item);
    if (at >= 0) this.index.set(at);
    if (last.verdict === 'skip') return;
    void last.token.then(async (undoToken) => {
      if (!undoToken) return;
      try {
        await this.trpc.faces.undoFaceEdit.mutate({ undoToken });
      } catch {
        this.toast.error('Could not undo that answer.');
      }
    });
  }

  protected async reload(): Promise<void> {
    this.snapshot.set(null);
    this.index.set(0);
    this.history.set([]);
    await this.candidates.refetch();
  }

  protected close(): void {
    if (this.changed) this.actions.invalidateFaces();
    this.closed.emit();
  }

  protected faceUrl(faceId: string): string {
    return `${this.apiUrl}/face/${faceId}`;
  }

  protected thumbUrl(fileId: string): string {
    return `${this.apiUrl}/asset/${fileId}/thumbnail`;
  }
}
