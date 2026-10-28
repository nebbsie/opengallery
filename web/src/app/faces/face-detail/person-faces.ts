import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  DOCUMENT,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  PLATFORM_ID,
  signal,
  viewChild,
} from '@angular/core';
import { isPlatformBrowser, NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ErrorAlert } from '@core/components/error/error';
import { PeoplePicker, PickerPerson } from '@core/components/people-picker/people-picker';
import { PluralPipe } from '@core/pipes/plural.pipe';
import { CacheKey } from '@core/services/cache-key.types';
import { ToastService } from '@core/services/toast/toast';
import { injectTrpc, RouterOutputs } from '@core/services/trpc';
import { environment } from '@env/environment';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCheck,
  lucideUserMinus,
  lucideUserPlus,
  lucideUsers,
  lucideX,
} from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { injectInfiniteQuery } from '@tanstack/angular-query-experimental';
import { FaceActions, faceAlt } from '../face-actions';

type PersonFace = RouterOutputs['faces']['listPersonFaces']['items'][number];

const SKELETON = Array.from({ length: 24 }, (_, i) => i);

// The API takes at most this many face ids in one edit.
const MAX_SELECTION = 5000;

// The "Faces" tab of a person page: every face crop on this person. The admin
// selects faces (click, shift-click for a range, select all) and fixes them:
// "Not <name>", "Move to...", or "New person". Others just browse the crops.
@Component({
  selector: 'app-person-faces',
  imports: [ErrorAlert, NgTemplateOutlet, NgIcon, HlmIcon, HlmButton, PeoplePicker, PluralPipe, RouterLink],
  providers: [provideIcons({ lucideCheck, lucideUserMinus, lucideUserPlus, lucideUsers, lucideX })],
  host: { class: 'flex min-h-0 flex-col' },
  template: `
    @if (isAdmin()) {
      <div
        class="glass-strong sticky top-0 z-10 mb-3 flex min-h-12 flex-wrap items-center gap-2 rounded-2xl px-3 py-2"
        role="toolbar"
        aria-label="Face actions"
      >
        @if (selectedCount() === 0) {
          <p class="text-muted-foreground text-sm text-pretty">
            Select faces that are not {{ name() || 'this person' }} to fix them. Shift-click selects
            a range.
          </p>
          @if (items().length > 0) {
            <button
              hlmBtn
              variant="ghost"
              class="ml-auto h-11 active:scale-[0.96] sm:h-9"
              (click)="selectAll()"
            >
              Select all
            </button>
          }
        } @else {
          <button
            hlmBtn
            variant="ghost"
            size="icon"
            class="size-11 active:scale-[0.96] sm:size-9"
            aria-label="Clear selection"
            (click)="clear()"
          >
            <ng-icon hlm size="sm" name="lucideX" />
          </button>
          <span class="text-foreground text-sm font-medium tabular-nums" aria-live="polite">
            {{ selectedCount() }} selected
          </span>
          @if (selectedCount() < items().length) {
            <button
              hlmBtn
              variant="ghost"
              class="h-11 active:scale-[0.96] sm:h-9"
              (click)="selectAll()"
            >
              Select all
            </button>
          }
          <div class="ml-auto flex flex-wrap gap-2">
            <button
              hlmBtn
              variant="outline"
              class="h-11 active:scale-[0.96] sm:h-9"
              [disabled]="busy()"
              (click)="notThisPerson()"
            >
              <ng-icon hlm size="sm" name="lucideUserMinus" />
              Not {{ name() || 'this person' }}
            </button>
            <button
              hlmBtn
              variant="outline"
              class="h-11 active:scale-[0.96] sm:h-9"
              [disabled]="busy()"
              [attr.aria-expanded]="moveOpen()"
              (click)="moveOpen.set(!moveOpen())"
            >
              <ng-icon hlm size="sm" name="lucideUsers" />
              Move to...
            </button>
            <button
              hlmBtn
              variant="outline"
              class="h-11 active:scale-[0.96] sm:h-9"
              [disabled]="busy()"
              (click)="newPerson()"
            >
              <ng-icon hlm size="sm" name="lucideUserPlus" />
              New person
            </button>
          </div>
        }
      </div>

      @if (moveOpen() && selectedCount() > 0) {
        <section class="bg-glass-tint mb-4 rounded-2xl border border-glass-border p-3" aria-label="Move faces to a person">
          <div class="mb-2 flex items-center justify-between">
            <h3 class="text-foreground text-sm font-semibold">
              Move {{ selectedCount() | plural: 'face' }} to...
            </h3>
            <button
              hlmBtn
              variant="ghost"
              size="icon"
              class="size-11 sm:size-9"
              aria-label="Close"
              (click)="moveOpen.set(false)"
            >
              <ng-icon hlm size="sm" name="lucideX" />
            </button>
          </div>
          <app-people-picker [single]="true" [exclude]="[personId()]" (pick)="moveTo($event)" />
        </section>
      }
    }

    @if (faces.isPending()) {
      <div class="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10" aria-hidden="true">
        @for (i of skeleton; track i) {
          <div class="bg-muted aspect-square animate-pulse rounded-lg"></div>
        }
      </div>
    } @else if (faces.isError() && !faces.data()) {
      <app-error-alert [error]="faces.error()" />
    } @else if (items().length === 0) {
      <p class="text-muted-foreground py-12 text-center text-sm">No faces on this person.</p>
    } @else {
      <ul
        class="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10"
        [attr.aria-label]="'Faces of ' + (name() || 'this person')"
      >
        @for (f of items(); track f.faceId; let i = $index) {
          <li class="relative">
            @if (isAdmin()) {
              <button
                type="button"
                class="focus-visible:ring-ring group relative block aspect-square w-full overflow-hidden rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-offset-2 active:scale-[0.96]"
                [attr.aria-pressed]="isSelected(f.faceId)"
                [attr.aria-label]="tileLabel(f)"
                (click)="onTileClick($event, i)"
              >
                <ng-container *ngTemplateOutlet="tile; context: { $implicit: f }" />
                <span
                  class="absolute top-1 left-1 grid size-6 place-items-center rounded-full border-2 transition-[opacity,background-color] duration-150"
                  [class]="
                    isSelected(f.faceId)
                      ? 'bg-primary border-primary text-primary-foreground opacity-100'
                      : selectedCount() > 0
                        ? 'border-white/90 bg-black/20 opacity-100'
                        : 'border-white/90 bg-black/20 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'
                  "
                  aria-hidden="true"
                >
                  @if (isSelected(f.faceId)) {
                    <ng-icon hlm size="xs" name="lucideCheck" />
                  }
                </span>
                @if (isSelected(f.faceId)) {
                  <span class="ring-primary pointer-events-none absolute inset-0 rounded-lg ring-4 ring-inset"></span>
                }
              </button>
            } @else {
              <a
                class="focus-visible:ring-ring relative block aspect-square overflow-hidden rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                [routerLink]="['/asset', f.fileId]"
                [queryParams]="{ from: '/faces/' + personId(), personId: personId() }"
                [attr.aria-label]="'Open the photo with ' + (name() || 'this person')"
              >
                <ng-container *ngTemplateOutlet="tile; context: { $implicit: f }" />
              </a>
            }
          </li>
        }
      </ul>
      <div #sentinel class="h-px w-full"></div>
      @if (faces.isFetchingNextPage()) {
        <p class="text-muted-foreground py-4 text-center text-sm">Loading more faces</p>
      }
    }

    <ng-template #tile let-f>
      <img
        class="bg-muted h-full w-full object-cover outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
        [src]="f.hasCrop ? faceUrl(f.faceId) : thumbUrl(f.fileId)"
        [alt]="faceAlt(name())"
        loading="lazy"
      />
      @if (f.confirmed) {
        <span
          class="bg-background text-primary absolute right-1 bottom-1 grid size-5 place-items-center rounded-full shadow"
          title="Confirmed"
        >
          <ng-icon hlm size="xs" name="lucideCheck" />
          <span class="sr-only">Confirmed</span>
        </span>
      }
    </ng-template>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonFaces {
  readonly personId = input.required<string>();
  readonly name = input<string | null>(null);
  readonly isAdmin = input(false);
  // The scroll container that holds this tab, for infinite scroll.
  readonly scrollRoot = input<HTMLElement | null>(null);

  private readonly trpc = injectTrpc();
  private readonly actions = inject(FaceActions);
  private readonly toast = inject(ToastService);
  private readonly sentinel = viewChild<ElementRef<HTMLElement>>('sentinel');
  private readonly apiUrl = environment.api.url;
  protected readonly skeleton = SKELETON;

  protected readonly faces = injectInfiniteQuery(() => ({
    queryKey: [CacheKey.FacePersonFaces, this.personId()],
    queryFn: async ({ pageParam }) =>
      this.trpc.faces.listPersonFaces.query({
        personId: this.personId(),
        limit: 100,
        cursor: pageParam,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  }));

  protected readonly items = computed<PersonFace[]>(
    () => this.faces.data()?.pages.flatMap((p) => p.items) ?? [],
  );

  private readonly selected = signal<ReadonlySet<string>>(new Set());
  // Index of the last plain click: the start of a shift-click range.
  private anchor: number | null = null;
  protected readonly selectedCount = computed(() => this.selected().size);
  protected readonly busy = signal(false);
  protected readonly moveOpen = signal(false);

  constructor() {
    // A new person: drop the old selection.
    effect(() => {
      this.personId();
      this.clear();
    });

    // Fetch the next page when the sentinel nears the viewport.
    effect((onCleanup) => {
      const el = this.sentinel()?.nativeElement;
      if (!el) return;
      const obs = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) this.loadMore();
        },
        { root: this.scrollRoot(), rootMargin: '600px' },
      );
      obs.observe(el);
      onCleanup(() => obs.disconnect());
    });

    // Escape clears the selection before the page's back-on-Escape runs.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.selectedCount() > 0) {
        e.preventDefault();
        e.stopPropagation();
        this.clear();
      }
    };
    if (isPlatformBrowser(inject(PLATFORM_ID))) {
      const doc = inject(DOCUMENT);
      doc.addEventListener('keydown', onKey, true);
      inject(DestroyRef).onDestroy(() => doc.removeEventListener('keydown', onKey, true));
    }
  }

  protected faceAlt = faceAlt;

  protected faceUrl(faceId: string): string {
    return `${this.apiUrl}/face/${faceId}`;
  }

  protected thumbUrl(fileId: string): string {
    return `${this.apiUrl}/asset/${fileId}/thumbnail`;
  }

  protected isSelected(faceId: string): boolean {
    return this.selected().has(faceId);
  }

  protected tileLabel(f: PersonFace): string {
    const who = faceAlt(this.name());
    const state = this.isSelected(f.faceId) ? 'selected' : 'not selected';
    return `${who}${f.confirmed ? ', confirmed' : ''}, ${state}`;
  }

  protected onTileClick(event: MouseEvent, index: number): void {
    const list = this.items();
    const face = list[index];
    if (!face) return;
    const next = new Set(this.selected());
    if (event.shiftKey && this.anchor !== null) {
      const [a, b] = this.anchor < index ? [this.anchor, index] : [index, this.anchor];
      for (let i = a; i <= b && next.size < MAX_SELECTION; i++) {
        const id = list[i]?.faceId;
        if (id) next.add(id);
      }
    } else {
      if (next.has(face.faceId)) next.delete(face.faceId);
      else if (next.size < MAX_SELECTION) next.add(face.faceId);
      else this.toast.show(`You can select up to ${MAX_SELECTION.toLocaleString()} faces at a time`);
      this.anchor = index;
    }
    this.selected.set(next);
  }

  protected selectAll(): void {
    const ids = this.items().map((f) => f.faceId);
    if (ids.length > MAX_SELECTION) {
      this.toast.show(`Selected the first ${MAX_SELECTION.toLocaleString()} faces, the most at a time`);
    }
    this.selected.set(new Set(ids.slice(0, MAX_SELECTION)));
  }

  protected clear(): void {
    this.selected.set(new Set());
    this.anchor = null;
    this.moveOpen.set(false);
  }

  private selectedIds(): string[] {
    return [...this.selected()];
  }

  protected async notThisPerson(): Promise<void> {
    await this.run(() =>
      this.actions.removeFaces(this.selectedIds(), this.name()),
    );
  }

  protected async moveTo(p: PickerPerson): Promise<void> {
    await this.run(() =>
      this.actions.assignFaces(this.selectedIds(), p.id, p.name),
    );
  }

  protected async newPerson(): Promise<void> {
    // Stay on this page; the toast has Undo. The new person shows in People.
    await this.run(
      async () => (await this.actions.createPerson(this.selectedIds())) !== null,
    );
  }

  private async run(action: () => Promise<boolean>): Promise<void> {
    if (this.busy() || this.selectedCount() === 0) return;
    this.busy.set(true);
    try {
      if (await action()) this.clear();
    } finally {
      this.busy.set(false);
    }
  }

  private loadMore(): void {
    if (this.faces.hasNextPage() && !this.faces.isFetchingNextPage()) {
      void this.faces.fetchNextPage();
    }
  }
}
