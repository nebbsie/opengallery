import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  model,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Auth } from '@core/services/auth/auth';
import { CacheKey, FACE_CACHE_KEYS } from '@core/services/cache-key.types';
import { ToastService } from '@core/services/toast/toast';
import { injectTrpc } from '@core/services/trpc';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { PersonPick, PersonPicker } from './person-picker';
import { Rect } from './zoom-pan';

type Box = { x: number; y: number; width: number; height: number };

export type ViewerFace = {
  faceId: string;
  personId: string | null;
  personName: string | null;
  box: Box;
  hasCrop: boolean;
  manual: boolean;
};

type PickerState =
  | { kind: 'assign'; face: ViewerFace }
  | { kind: 'tag'; box: Box }
  | null;

// Smallest box (as a share of the photo side) that counts as a tagged face.
const MIN_TAG_SIZE = 0.02;

export const viewerFacesKey = (fileId: string) => [CacheKey.ViewerFaces, fileId] as const;

// Face boxes over the photo in the viewer. The box layer gets the same
// transform as the zoomed image and sits on the image's object-contain rect,
// so boxes stay on the faces at any zoom and with letterboxing. Chips and
// borders are scaled by 1/scale so they keep their size on screen.
@Component({
  selector: 'app-face-overlay',
  imports: [RouterLink, PersonPicker],
  host: { class: 'pointer-events-none absolute inset-0 z-10 block' },
  template: `
    <div
      class="absolute inset-0 origin-center"
      [style.transform]="transform()"
      [style.transition]="transition()"
    >
      <div
        #content
        class="absolute"
        [style.left.px]="rect().left"
        [style.top.px]="rect().top"
        [style.width.px]="rect().width"
        [style.height.px]="rect().height"
      >
        @for (face of faces(); track face.faceId) {
          <div
            class="group absolute"
            [style.left.%]="face.box.x * 100"
            [style.top.%]="face.box.y * 100"
            [style.width.%]="face.box.width * 100"
            [style.height.%]="face.box.height * 100"
            [style.z-index]="selectedId() === face.faceId ? 2 : 1"
          >
            <!-- data-face-box: the stage still starts a swipe, pinch, pan or
                 double tap here; a press that moves past the slop is no click. -->
            <button
              type="button"
              data-face-box
              class="pointer-events-auto absolute inset-0 rounded-md border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.35)] outline-none focus-visible:border-sky-400"
              [style.border-width.px]="2 / scale()"
              [class.border-sky-400]="selectedId() === face.faceId"
              [attr.aria-label]="'Face: ' + label(face)"
              [attr.aria-expanded]="selectedId() === face.faceId"
              (click)="toggleSelect(face.faceId)"
            ></button>

            <div
              class="pointer-events-auto absolute top-full left-1/2 pt-1 group-focus-within:block group-hover:block"
              [class.hidden]="selectedId() !== face.faceId"
              [style.transform]="'translateX(-50%) scale(' + 1 / scale() + ')'"
              style="transform-origin: top center"
            >
              <div
                class="flex w-max max-w-[16rem] flex-col items-stretch gap-0.5 rounded-xl bg-black/80 p-1 text-sm text-white shadow-lg backdrop-blur-sm"
              >
                @if (face.personId) {
                  <a
                    class="flex min-h-11 items-center rounded-lg px-3 font-medium outline-none hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white"
                    [routerLink]="['/faces', face.personId]"
                  >
                    <span class="truncate">{{ face.personName || 'Unnamed person' }}</span>
                  </a>
                } @else {
                  <span class="flex min-h-11 items-center px-3 text-white/70">Unknown</span>
                }
                @if (isAdmin()) {
                  @if (face.personId) {
                    <button type="button" [class]="chipAction" (click)="notThisPerson(face)">
                      Not {{ face.personName || 'this person' }}
                    </button>
                  }
                  <button type="button" [class]="chipAction" (click)="openAssign(face)">
                    {{ face.personId ? 'This is someone else' : 'This is...' }}
                  </button>
                }
              </div>
            </div>
          </div>
        }

        @if (tagMode()) {
          <div
            class="pointer-events-auto absolute inset-0 cursor-crosshair touch-none"
            data-tag-layer
            (pointerdown)="tagStart($event)"
            (pointermove)="tagMove($event)"
            (pointerup)="tagEnd($event)"
            (pointercancel)="cancelDraft()"
          >
            @if (draftBox(); as d) {
              <div
                class="absolute rounded-md border-sky-400 bg-sky-400/15"
                [style.border-width.px]="2 / scale()"
                [style.left.%]="d.x * 100"
                [style.top.%]="d.y * 100"
                [style.width.%]="d.width * 100"
                [style.height.%]="d.height * 100"
              ></div>
            }
          </div>
        }
      </div>
    </div>

    <!-- Hints sit outside the zoomed layer so they keep their place. -->
    @if (tagMode() && !picker()) {
      <p
        class="absolute top-20 left-1/2 -translate-x-1/2 rounded-full bg-black/75 px-4 py-2 text-sm text-white shadow-lg"
        role="status"
      >
        Drag a box around a face
      </p>
    } @else if (facesQuery.isSuccess() && faces().length === 0 && !picker()) {
      <p
        class="absolute top-20 left-1/2 -translate-x-1/2 rounded-full bg-black/75 px-4 py-2 text-sm text-white shadow-lg"
        role="status"
      >
        No faces found in this photo
      </p>
    }

    @if (picker(); as p) {
      <div
        class="pointer-events-auto absolute inset-0 z-20 grid place-items-center bg-black/40"
        data-no-gesture
        (click)="cancelPicker()"
      >
        <app-person-picker
          [title]="p.kind === 'tag' ? 'Who is this?' : 'Who is this really?'"
          [currentPersonId]="p.kind === 'assign' ? p.face.personId : null"
          (click)="$event.stopPropagation()"
          (picked)="onPicked($event)"
          (cancel)="cancelPicker()"
        />
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FaceOverlay {
  private readonly trpc = injectTrpc();
  private readonly queryClient = inject(QueryClient);
  private readonly toast = inject(ToastService);
  protected readonly isAdmin = inject(Auth).isAdmin;

  readonly fileId = input.required<string>();
  /** The zoom transform of the image layer. */
  readonly transform = input('none');
  readonly transition = input('none');
  readonly scale = input(1);
  /** The image's object-contain rect inside the viewport, at 1x. */
  readonly rect = input.required<Rect>();
  readonly tagMode = model(false);

  protected readonly chipAction =
    'flex min-h-11 items-center rounded-lg px-3 text-left outline-none hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white';

  protected readonly selectedId = signal<string | null>(null);
  protected readonly picker = signal<PickerState>(null);
  protected readonly draft = signal<{ x0: number; y0: number; x1: number; y1: number } | null>(
    null,
  );
  private readonly content = viewChild.required<ElementRef<HTMLDivElement>>('content');
  // The pointer that draws the tag box. A second finger is a pinch or pan for
  // the stage, not a box.
  private tagPointer: number | null = null;

  /** True while a tag box or the person picker is open: prev / next waits. */
  readonly editing = computed(() => !!this.picker() || !!this.draft());

  constructor() {
    // A new photo: nothing from the old one may save on it.
    effect(() => {
      this.fileId();
      untracked(() => {
        this.picker.set(null);
        this.cancelDraft();
        this.selectedId.set(null);
      });
    });
  }

  readonly facesQuery = injectQuery(() => ({
    queryKey: viewerFacesKey(this.fileId()),
    queryFn: async (): Promise<ViewerFace[]> =>
      this.trpc.faces.getFacesForFile.query({ fileId: this.fileId() }),
    staleTime: 30_000,
  }));

  protected readonly faces = computed(() => this.facesQuery.data() ?? []);

  protected readonly draftBox = computed<Box | null>(() => {
    const d = this.draft();
    if (!d) return null;
    return {
      x: Math.min(d.x0, d.x1),
      y: Math.min(d.y0, d.y1),
      width: Math.abs(d.x1 - d.x0),
      height: Math.abs(d.y1 - d.y0),
    };
  });

  protected label(face: ViewerFace): string {
    return face.personId ? face.personName || 'Unnamed person' : 'Unknown person';
  }

  protected toggleSelect(faceId: string): void {
    this.selectedId.update((cur) => (cur === faceId ? null : faceId));
  }

  /** Handles Escape. Returns true when the overlay used the key. */
  escape(): boolean {
    if (this.picker()) {
      this.cancelPicker();
      return true;
    }
    if (this.tagMode()) {
      this.tagMode.set(false);
      this.cancelDraft();
      return true;
    }
    if (this.selectedId()) {
      this.selectedId.set(null);
      return true;
    }
    return false;
  }

  protected cancelPicker(): void {
    this.picker.set(null);
    this.cancelDraft();
  }

  /** Drops the tag box being drawn (the stage calls it when a pinch starts). */
  cancelDraft(): void {
    this.tagPointer = null;
    if (!this.picker()) this.draft.set(null);
  }

  protected openAssign(face: ViewerFace): void {
    this.picker.set({ kind: 'assign', face });
  }

  // Tag a face: the box is drawn in the coordinates of the photo itself. The
  // bounding rect of the content layer already includes the zoom transform.
  private toNormalized(event: PointerEvent): { x: number; y: number } {
    const r = this.content().nativeElement.getBoundingClientRect();
    const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
    return {
      x: clamp01((event.clientX - r.left) / r.width),
      y: clamp01((event.clientY - r.top) / r.height),
    };
  }

  // The event also reaches the stage, which ignores one pointer in tag mode
  // and turns a second one into a pinch.
  protected tagStart(event: PointerEvent): void {
    if (event.button !== 0 || this.picker()) return;
    if (this.tagPointer !== null) {
      // A second finger: a pinch or pan, not a box.
      this.cancelDraft();
      return;
    }
    this.tagPointer = event.pointerId;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const p = this.toNormalized(event);
    this.draft.set({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  }

  protected tagMove(event: PointerEvent): void {
    const d = this.draft();
    if (!d || this.picker() || event.pointerId !== this.tagPointer) return;
    const p = this.toNormalized(event);
    this.draft.set({ ...d, x1: p.x, y1: p.y });
  }

  protected tagEnd(event: PointerEvent): void {
    if (event.pointerId !== this.tagPointer || this.picker()) return;
    this.tagMove(event);
    this.tagPointer = null;
    const box = this.draftBox();
    if (!box || box.width < MIN_TAG_SIZE || box.height < MIN_TAG_SIZE) {
      this.draft.set(null);
      return;
    }
    this.picker.set({ kind: 'tag', box });
  }

  protected async onPicked(pick: PersonPick): Promise<void> {
    const state = this.picker();
    if (!state) return;
    this.picker.set(null);
    this.draft.set(null);
    try {
      if (state.kind === 'tag') {
        await this.trpc.faces.addManualFace.mutate({
          fileId: this.fileId(),
          box: state.box,
          ...('personId' in pick ? { personId: pick.personId } : { name: pick.name }),
        });
        this.tagMode.set(false);
        this.toast.success(`Tagged ${'name' in pick ? pick.name : this.personName(pick.personId)}`);
      } else if ('personId' in pick) {
        if (pick.personId === state.face.personId) return;
        await this.trpc.faces.assignFaces.mutate({
          faceIds: [state.face.faceId],
          personId: pick.personId,
        });
        this.toast.success(`Moved to ${this.personName(pick.personId)}`);
      } else {
        await this.trpc.faces.createPersonFromFaces.mutate({
          faceIds: [state.face.faceId],
          name: pick.name,
        });
        this.toast.success(`Tagged ${pick.name}`);
      }
      this.selectedId.set(null);
      await this.invalidate();
    } catch {
      this.toast.error('Could not save that face. Try again.');
    }
  }

  protected async notThisPerson(face: ViewerFace): Promise<void> {
    const oldPersonId = face.personId;
    if (!oldPersonId) return;
    const name = face.personName || 'this person';
    try {
      const { undoToken } = await this.trpc.faces.removeFaces.mutate({ faceIds: [face.faceId] });
      this.selectedId.set(null);
      await this.invalidate();
      this.toast.show(`Removed from ${name}`, {
        action: {
          label: 'Undo',
          run: async () => {
            try {
              await this.trpc.faces.undoFaceEdit.mutate({ undoToken });
            } catch {
              this.toast.error('Could not undo. The undo may have expired.');
              return;
            }
            await this.invalidate();
          },
        },
      });
    } catch {
      this.toast.error('Could not remove that face. Try again.');
    }
  }

  private personName(personId: string): string {
    const lists = this.queryClient.getQueriesData<Array<{ id: string; name: string | null }>>({
      queryKey: [CacheKey.FacesAll],
    });
    for (const [, list] of lists) {
      const hit = Array.isArray(list) ? list.find((p) => p.id === personId) : undefined;
      if (hit) return hit.name || 'an unnamed person';
    }
    return 'that person';
  }

  // The viewer (people chips, face boxes) and every people list change.
  private invalidate(): Promise<unknown> {
    return Promise.all(
      FACE_CACHE_KEYS.map((key) => this.queryClient.invalidateQueries({ queryKey: [key] })),
    );
  }
}
