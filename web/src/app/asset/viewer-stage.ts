import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { environment } from '@env/environment';
import { RotationService } from '@core/services/rotation/rotation';
import { FaceOverlay } from './face-overlay';
import { containRect, TAP_ZOOM, ZoomPan } from './zoom-pan';

export interface StageSlot {
  id: string;
  /** -1 = previous, 0 = current, 1 = next. */
  pos: -1 | 0 | 1;
  /** null while the type is not known yet: the thumbnail shows alone. */
  type: 'image' | 'video' | null;
  mime: string | null;
  /** Size from the metadata, used until the thumbnail tells us the real one. */
  width: number | null;
  height: number | null;
  /** Clockwise turn the user gave the photo (file.rotation). */
  rotation: number;
}

type Gesture = 'none' | 'pending' | 'ignored' | 'swipe' | 'dismiss' | 'swipe-up' | 'pan' | 'pinch';

// Gap between slides while swiping, in px.
const GAP = 24;
const SLIDE_MS = 260;
const EASE = 'cubic-bezier(0.2, 0, 0, 1)';
// At this zoom the viewer swaps in the original file (when the browser can show it).
const ORIGINAL_AT = 2;
// Originals the browser can decode. RAW and HEIC stay on the optimised variant.
const DISPLAYABLE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

/**
 * The media area of the viewer: the current photo or video plus its
 * neighbours on either side, so a swipe moves the photo with the finger and
 * slides the next one in. Handles every gesture with pointer events:
 * - swipe left / right to move to the next / previous item,
 * - swipe down to close, swipe up for the info panel,
 * - pinch, double tap, double click, ctrl+wheel and the wheel to zoom,
 * - drag (or two fingers) to pan while zoomed.
 * While zoomed, swipe and swipe-down are off so a drag always pans.
 */
@Component({
  selector: 'app-viewer-stage',
  imports: [FaceOverlay],
  host: { class: 'relative block h-full w-full' },
  template: `
    <div
      #viewport
      class="absolute inset-0 overflow-hidden select-none"
      style="touch-action: none"
      [class.cursor-grab]="zoom.isZoomed() && gesture() !== 'pan'"
      [class.cursor-grabbing]="gesture() === 'pan'"
      [style.opacity]="closing() ? 0 : 1"
      [style.transition]="'opacity 150ms ease-out'"
      (pointerdown)="onPointerDown($event)"
      (pointermove)="onPointerMove($event)"
      (pointerup)="onPointerUp($event, false)"
      (pointercancel)="onPointerUp($event, true)"
      (dblclick)="onDblClick($event)"
      (wheel)="onWheel($event)"
    >
      @for (slot of slots(); track slot.id) {
        <div
          class="absolute inset-0"
          [attr.aria-hidden]="slot.pos !== 0"
          [style.transform]="slotTransform(slot.pos)"
          [style.transition]="animate() ? 'transform ' + slideMs + 'ms ' + ease : 'none'"
        >
          <div
            class="absolute inset-0 origin-center"
            [style.transform]="slot.pos === 0 ? currentTransform() : null"
            [style.transition]="slot.pos === 0 ? currentTransition() : null"
          >
            @if (slot.pos === 0 && slot.type === 'video') {
              <video
                [src]="apiUrl + '/asset/' + slot.id + '/optimised'"
                [poster]="apiUrl + '/asset/' + slot.id + '/thumbnail'"
                [attr.aria-label]="alt()"
                class="absolute inset-0 h-full w-full object-contain"
                controls
                playsInline
                autoplay
              ></video>
            } @else {
              <!-- The grid thumbnail is in the browser cache, so it shows at once at
                   full size. The large image fades in over it when it has loaded. -->
              <!-- While a rotate is encoded the old variant is turned by CSS, in a
                   box with width and height swapped for a quarter turn. -->
              <div class="absolute" [style]="turnBox(slot.id)">
                <img
                  [src]="thumbUrl(slot)"
                  alt=""
                  draggable="false"
                  decoding="async"
                  class="absolute inset-0 h-full w-full object-contain"
                  [style.visibility]="isLoaded(optimisedUrl(slot)) ? 'hidden' : 'visible'"
                  [style.transition]="'visibility 0s linear 250ms'"
                  (load)="onNatural(slot.id, $event)"
                />
                @if (slot.type === 'image') {
                  <img
                    [src]="optimisedUrl(slot)"
                    [alt]="slot.pos === 0 ? alt() : ''"
                    draggable="false"
                    decoding="async"
                    class="absolute inset-0 h-full w-full object-contain transition-opacity duration-200 ease-out"
                    [class.opacity-0]="!isLoaded(optimisedUrl(slot))"
                    (load)="markLoaded(optimisedUrl(slot))"
                  />
                  @if (slot.pos === 0 && showOriginal()) {
                    <img
                      [src]="originalUrl(slot.id)"
                      alt=""
                      draggable="false"
                      decoding="async"
                      class="absolute inset-0 h-full w-full object-contain transition-opacity duration-200 ease-out"
                      [class.opacity-0]="!isLoaded(originalUrl(slot.id))"
                      (load)="markLoaded(originalUrl(slot.id))"
                    />
                  }
                }
              </div>
              @if (slot.type === 'image' && slot.pos === 0 && motionUrl() && liveOn()) {
                <!-- Live Photo with Live on: the motion video loops over the
                     still, muted and without controls. It stays invisible until
                     it plays, so there is no black frame. -->
                <video
                  [src]="motionUrl()"
                  class="pointer-events-none absolute inset-0 h-full w-full object-contain transition-opacity duration-300 ease-out"
                  [class.opacity-0]="!motionReady()"
                  muted
                  loop
                  playsInline
                  autoplay
                  disablePictureInPicture
                  (playing)="motionReady.set(true)"
                  (error)="motionReady.set(false)"
                ></video>
              }
            }
          </div>
        </div>
      }

      @if (overlayVisible()) {
        <app-face-overlay
          [fileId]="currentId()!"
          [rect]="contentRect()"
          [scale]="zoom.scale()"
          [transform]="zoom.transform()"
          [transition]="currentTransition()"
          [(tagMode)]="tagMode"
        />
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ViewerStage {
  protected readonly apiUrl = environment.api.url;
  protected readonly slideMs = SLIDE_MS;
  protected readonly ease = EASE;

  readonly slots = input.required<StageSlot[]>();
  readonly alt = input('');
  readonly showFaces = input(false);
  readonly tagMode = model(false);
  /** Live Photo video of the current still, or null. */
  readonly motionUrl = input<string | null>(null);
  /** Live on: the motion video loops over the still. Off: the still only. */
  readonly liveOn = input(false);
  /** True once the motion video plays (it fades in over the still). */
  protected readonly motionReady = signal(false);

  private readonly rotation = inject(RotationService);

  readonly navigate = output<'prev' | 'next'>();
  readonly dismiss = output<void>();
  /** A single tap on touch: the parent shows or hides its controls. */
  readonly tapped = output<void>();
  readonly swipeUp = output<void>();

  readonly zoom = new ZoomPan();

  private readonly viewport = viewChild.required<ElementRef<HTMLDivElement>>('viewport');
  private readonly overlay = viewChild(FaceOverlay);
  /** True while a face tag or the person picker is open: prev / next waits. */
  readonly navBlocked = computed(() => this.overlay()?.editing() ?? false);

  protected readonly current = computed(() => this.slots().find((s) => s.pos === 0) ?? null);
  readonly currentId = computed(() => this.current()?.id ?? null);
  private readonly hasPrev = computed(() => this.slots().some((s) => s.pos === -1));
  private readonly hasNext = computed(() => this.slots().some((s) => s.pos === 1));
  private readonly isImage = computed(() => this.current()?.type === 'image');

  // Viewport size in CSS px.
  private readonly vw = signal(0);
  private readonly vh = signal(0);

  // Natural size per id, read from the thumbnail (it is already rotated).
  private readonly natural = signal<Record<string, { w: number; h: number }>>({});
  private readonly loaded = signal<ReadonlySet<string>>(new Set());

  protected readonly contentRect = computed(() => {
    const cur = this.current();
    const n = cur ? this.natural()[cur.id] : undefined;
    const w = n?.w ?? cur?.width ?? 0;
    const h = n?.h ?? cur?.height ?? 0;
    return containRect(this.vw(), this.vh(), w, h);
  });

  // Live gesture state.
  readonly gesture = signal<Gesture>('none');
  /** Horizontal offset of the slide track while swiping, in px. */
  private readonly offset = signal(0);
  private readonly dragX = signal(0);
  private readonly dragY = signal(0);
  protected readonly animate = signal(false);
  private readonly zoomAnimate = signal(false);
  protected readonly closing = signal(false);
  private readonly originalWanted = signal(false);
  private committing = false;

  /** 0 at rest, up to 1 as the photo is dragged down to close. */
  readonly dismissProgress = computed(() => {
    const h = this.vh() || 1;
    return Math.min(1, Math.max(0, this.dragY()) / (h * 0.6));
  });

  protected readonly showOriginal = computed(() => {
    const cur = this.current();
    // The original's pixels are not turned: a turned photo stays on its variant.
    return (
      this.originalWanted() &&
      !!cur?.mime &&
      DISPLAYABLE.has(cur.mime) &&
      !cur.rotation &&
      !this.rotation.turn(cur.id)
    );
  });

  protected readonly overlayVisible = computed(
    () =>
      this.showFaces() &&
      this.isImage() &&
      !!this.currentId() &&
      // The faces are being found again on the turned pixels.
      !this.rotation.turn(this.currentId()!) &&
      this.offset() === 0 &&
      this.dragY() === 0 &&
      !this.closing(),
  );

  protected readonly currentTransform = computed(() => {
    const dy = this.dragY();
    const dx = this.dragX();
    if (dy !== 0 || dx !== 0) {
      const s = 1 - this.dismissProgress() * 0.25;
      return `translate3d(${dx}px, ${dy}px, 0) scale(${s})`;
    }
    return this.zoom.transform();
  });

  protected readonly currentTransition = computed(() =>
    this.zoomAnimate() ? `transform 250ms ${EASE}` : 'none',
  );

  private readonly pointers = new Map<number, { x: number; y: number }>();
  private startX = 0;
  private startY = 0;
  private lastX = 0;
  private lastY = 0;
  private samples: Array<{ x: number; y: number; t: number }> = [];
  private pinchPrev: { dist: number; mx: number; my: number } | null = null;
  private pointerType = 'mouse';
  private lastTap: { t: number; x: number; y: number } | null = null;
  private tapTimer: ReturnType<typeof setTimeout> | null = null;
  private timers: Array<ReturnType<typeof setTimeout>> = [];
  // The gesture started on a face box button.
  private onFaceBox = false;
  // The pointer moved past the slop (or a pinch started): the click that the
  // browser fires after it is not a click on a face box.
  private suppressClick = false;
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    // A new photo, or Live switched: show the still until the video plays.
    effect(() => {
      this.currentId();
      this.motionUrl();
      this.liveOn();
      untracked(() => this.motionReady.set(false));
    });

    // New current item: back to 1x, track centred, no slide animation for the
    // jump (the track already shows the new item where it needs to be).
    effect(() => {
      this.currentId();
      untracked(() => {
        this.zoom.reset();
        this.offset.set(0);
        this.dragX.set(0);
        this.dragY.set(0);
        this.animate.set(false);
        this.zoomAnimate.set(false);
        this.closing.set(false);
        this.originalWanted.set(false);
        this.committing = false;
        this.gesture.set('none');
        this.pointers.clear();
        this.tagMode.set(false);
      });
    });

    effect(() => {
      const r = this.contentRect();
      this.zoom.setGeometry(this.vw(), this.vh(), r.width, r.height);
    });

    // Load the original once the zoom passes ORIGINAL_AT, and keep it.
    effect(() => {
      if (this.zoom.scale() >= ORIGINAL_AT) untracked(() => this.originalWanted.set(true));
    });

    afterNextRender(() => {
      const el = this.viewport().nativeElement;
      const measure = () => {
        this.vw.set(el.clientWidth);
        this.vh.set(el.clientHeight);
      };
      measure();
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      // Capture phase: runs before the face box button's own click handler.
      const onClick = (e: MouseEvent) => {
        if (!this.suppressClick) return;
        this.suppressClick = false;
        e.preventDefault();
        e.stopPropagation();
      };
      el.addEventListener('click', onClick, true);
      this.destroyRef.onDestroy(() => {
        ro.disconnect();
        el.removeEventListener('click', onClick, true);
      });
    });

    this.destroyRef.onDestroy(() => {
      if (this.tapTimer) clearTimeout(this.tapTimer);
      this.timers.forEach(clearTimeout);
    });
  }

  protected thumbUrl(slot: StageSlot): string {
    return this.rotation.variantUrl(slot.id, 'thumbnail', slot.rotation);
  }

  protected optimisedUrl(slot: StageSlot): string {
    return this.rotation.variantUrl(slot.id, 'optimised', slot.rotation);
  }

  // Box of the images: the whole stage, or for a pending quarter turn a box
  // with width and height swapped, turned around its centre to fill the stage.
  protected turnBox(id: string): Record<string, string> {
    const turn = this.rotation.turn(id);
    if (!turn) return { inset: '0' };
    const w = this.vw();
    const h = this.vh();
    const quarter = Math.abs(turn) % 180 === 90;
    const bw = quarter ? h : w;
    const bh = quarter ? w : h;
    return {
      width: `${bw}px`,
      height: `${bh}px`,
      left: `${(w - bw) / 2}px`,
      top: `${(h - bh) / 2}px`,
      transform: `rotate(${turn}deg)`,
      transition: 'transform 200ms ease-out',
    };
  }

  protected originalUrl(id: string): string {
    return `${this.apiUrl}/asset/${id}`;
  }

  protected isLoaded(url: string): boolean {
    return this.loaded().has(url);
  }

  protected markLoaded(url: string): void {
    if (this.loaded().has(url)) return;
    this.loaded.update((s) => new Set(s).add(url));
  }

  protected onNatural(id: string, event: Event): void {
    const img = event.target as HTMLImageElement;
    if (!img.naturalWidth || !img.naturalHeight) return;
    this.natural.update((m) => ({ ...m, [id]: { w: img.naturalWidth, h: img.naturalHeight } }));
  }

  protected slotTransform(pos: number): string {
    const px = pos * GAP + this.offset();
    return `translate3d(calc(${pos * 100}% + ${px}px), 0, 0)`;
  }

  // Public controls for keys and buttons.

  zoomIn(): void {
    if (!this.isImage()) return;
    this.withZoomAnimation(() =>
      this.zoom.zoomTo(this.zoom.isZoomed() ? this.zoom.scale() * 1.6 : TAP_ZOOM),
    );
  }

  zoomOut(): void {
    if (!this.isImage()) return;
    this.withZoomAnimation(() => {
      const next = this.zoom.scale() / 1.6;
      if (next < 1.1) this.zoom.reset();
      else this.zoom.zoomTo(next);
    });
  }

  resetZoom(): void {
    this.withZoomAnimation(() => this.zoom.reset());
  }

  /** Handles Escape. Returns true when the stage used the key. */
  escape(): boolean {
    if (this.overlay()?.escape()) return true;
    if (this.zoom.isZoomed()) {
      this.resetZoom();
      return true;
    }
    return false;
  }

  private withZoomAnimation(fn: () => void): void {
    this.zoomAnimate.set(true);
    fn();
  }

  private later(fn: () => void, ms: number): void {
    this.timers.push(setTimeout(fn, ms));
  }

  // Point relative to the viewport centre.
  private centred(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.viewport().nativeElement.getBoundingClientRect();
    return { x: clientX - r.left - r.width / 2, y: clientY - r.top - r.height / 2 };
  }

  // Gestures.

  // Controls block gestures, but a face box does not: a swipe, pinch, pan or
  // double tap can start on a face, and only a press that stays inside the
  // slop is a click on the box.
  private blocksGesture(target: EventTarget | null): boolean {
    const el = (target as HTMLElement | null)?.closest(
      '[data-no-gesture], button, a, input, textarea, select',
    );
    return !!el && !el.hasAttribute('data-face-box');
  }

  protected onPointerDown(e: PointerEvent): void {
    if (this.blocksGesture(e.target)) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (this.committing || this.closing()) return;
    this.pointerType = e.pointerType;

    // Leave the bottom of a video to its own controls (scrub bar).
    if (this.current()?.type === 'video') {
      const r = this.viewport().nativeElement.getBoundingClientRect();
      if (e.clientY > r.bottom - 72) return;
    }

    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.pointers.size === 1) {
      this.onFaceBox = !!(e.target as HTMLElement | null)?.closest('[data-face-box]');
      this.suppressClick = false;
      // Tag mode: one pointer draws a box in the overlay. Two fingers still
      // pinch and pan (below).
      this.gesture.set(this.tagMode() ? 'ignored' : 'pending');
      this.startX = this.lastX = e.clientX;
      this.startY = this.lastY = e.clientY;
      this.samples = [{ x: e.clientX, y: e.clientY, t: e.timeStamp }];
      return;
    }

    if (this.pointers.size === 2 && this.isImage()) {
      // Two fingers: pinch zoom and pan. Any swipe in progress goes back.
      this.springBack();
      this.overlay()?.cancelDraft();
      this.suppressClick = true;
      this.gesture.set('pinch');
      this.zoomAnimate.set(false);
      const el = this.viewport().nativeElement;
      for (const id of this.pointers.keys()) {
        try {
          el.setPointerCapture(id);
        } catch {
          // The pointer may be gone already.
        }
      }
      this.pinchPrev = this.pinchState();
    }
  }

  private pinchState(): { dist: number; mx: number; my: number } {
    const [a, b] = [...this.pointers.values()];
    const mid = this.centred((a.x + b.x) / 2, (a.y + b.y) / 2);
    return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: mid.x, my: mid.y };
  }

  protected onPointerMove(e: PointerEvent): void {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = this.gesture();

    if (g === 'pinch') {
      if (this.pointers.size < 2 || !this.pinchPrev) return;
      const next = this.pinchState();
      this.zoom.zoomBy(next.dist / this.pinchPrev.dist, next.mx, next.my);
      this.zoom.panBy(next.mx - this.pinchPrev.mx, next.my - this.pinchPrev.my);
      this.pinchPrev = next;
      return;
    }

    const dx = e.clientX - this.startX;
    const dy = e.clientY - this.startY;
    this.samples.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
    if (this.samples.length > 6) this.samples.shift();

    if (g === 'pending') {
      const slop = e.pointerType === 'mouse' ? 4 : 8;
      if (Math.hypot(dx, dy) < slop) return;
      if (this.onFaceBox) this.suppressClick = true;
      if (this.zoom.isZoomed()) {
        this.gesture.set('pan');
        this.zoomAnimate.set(false);
      } else if (e.pointerType === 'mouse') {
        this.gesture.set('ignored');
        return;
      } else if (Math.abs(dx) > Math.abs(dy)) {
        this.gesture.set('swipe');
      } else if (dy > 0) {
        this.gesture.set('dismiss');
      } else {
        this.gesture.set('swipe-up');
      }
      this.animate.set(false);
      this.zoomAnimate.set(false);
      try {
        this.viewport().nativeElement.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }

    switch (this.gesture()) {
      case 'pan':
        this.zoom.panBy(e.clientX - this.lastX, e.clientY - this.lastY);
        break;
      case 'swipe': {
        // Rubber band at the ends where there is nothing to move to.
        const blocked = (dx > 0 && !this.hasPrev()) || (dx < 0 && !this.hasNext());
        this.offset.set(blocked ? dx * 0.3 : dx);
        break;
      }
      case 'dismiss':
        this.dragX.set(dx);
        this.dragY.set(Math.max(0, dy));
        break;
    }
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  }

  private velocity(): { vx: number; vy: number } {
    const s = this.samples;
    if (s.length < 2) return { vx: 0, vy: 0 };
    const a = s[0];
    const b = s[s.length - 1];
    const dt = Math.max(1, b.t - a.t);
    return { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt };
  }

  protected onPointerUp(e: PointerEvent, cancelled: boolean): void {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    const g = this.gesture();

    if (g === 'pinch') {
      this.pinchPrev = null;
      if (this.pointers.size === 1) {
        // One finger left on the glass: keep panning with it.
        const [p] = [...this.pointers.values()];
        this.lastX = p.x;
        this.lastY = p.y;
        this.gesture.set(this.zoom.isZoomed() ? 'pan' : 'ignored');
      } else if (this.pointers.size === 0) {
        this.gesture.set('none');
        if (this.zoom.scale() < 1.05) this.resetZoom();
      }
      return;
    }

    if (this.pointers.size > 0) return;
    this.gesture.set('none');
    const { vx, vy } = this.velocity();
    const w = this.vw() || 1;

    switch (g) {
      case 'pending':
        if (!cancelled) this.onTap(e, this.onFaceBox);
        break;
      case 'swipe': {
        const off = this.offset();
        if (!cancelled && (off < -w * 0.2 || (vx < -0.4 && off < 0)) && this.hasNext()) {
          this.commit('next');
        } else if (!cancelled && (off > w * 0.2 || (vx > 0.4 && off > 0)) && this.hasPrev()) {
          this.commit('prev');
        } else {
          this.springBack();
        }
        break;
      }
      case 'dismiss':
        if (!cancelled && (this.dragY() > 120 || vy > 0.5)) {
          this.closing.set(true);
          this.later(() => this.dismiss.emit(), 150);
        } else {
          this.springBack();
        }
        break;
      case 'swipe-up':
        if (!cancelled && (e.clientY - this.startY < -60 || vy < -0.4)) this.swipeUp.emit();
        break;
    }
  }

  private springBack(): void {
    this.animate.set(true);
    this.zoomAnimate.set(true);
    this.offset.set(0);
    this.dragX.set(0);
    this.dragY.set(0);
  }

  // Slide the whole track one place, then tell the parent to route. When the
  // new id arrives the slots shift by one and the offset resets in the same
  // frame, so the picture does not move.
  private commit(dir: 'prev' | 'next'): void {
    this.committing = true;
    this.animate.set(true);
    const w = this.vw() + GAP;
    this.offset.set(dir === 'next' ? -w : w);
    this.later(() => this.navigate.emit(dir), SLIDE_MS);
    // Safety net if the route does not change (e.g. a failed navigation).
    this.later(() => {
      if (this.committing) {
        this.committing = false;
        this.animate.set(false);
        this.offset.set(0);
      }
    }, SLIDE_MS + 1500);
  }

  // A tap on a face box is the box's click, so it only counts towards a
  // double tap and does not show or hide the controls.
  private onTap(e: PointerEvent, onFaceBox = false): void {
    if (e.pointerType === 'mouse') return;
    const now = e.timeStamp;
    const last = this.lastTap;
    if (last && now - last.t < 300 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 40) {
      this.lastTap = null;
      if (this.tapTimer) clearTimeout(this.tapTimer);
      this.tapTimer = null;
      if (this.isImage()) {
        const p = this.centred(e.clientX, e.clientY);
        this.withZoomAnimation(() => this.zoom.toggleAt(p.x, p.y));
      }
      return;
    }
    this.lastTap = { t: now, x: e.clientX, y: e.clientY };
    if (this.tapTimer) clearTimeout(this.tapTimer);
    this.tapTimer = null;
    if (onFaceBox) return;
    this.tapTimer = setTimeout(() => {
      this.tapTimer = null;
      this.tapped.emit();
    }, 300);
  }

  protected onDblClick(e: MouseEvent): void {
    // Touch double taps are handled in onTap.
    if (this.pointerType !== 'mouse' || !this.isImage()) return;
    if (this.blocksGesture(e.target) || this.tagMode()) return;
    const p = this.centred(e.clientX, e.clientY);
    this.withZoomAnimation(() => this.zoom.toggleAt(p.x, p.y));
  }

  protected onWheel(e: WheelEvent): void {
    if (!this.isImage() || this.closing()) return;
    if ((e.target as HTMLElement | null)?.closest('[data-no-gesture]')) return;
    const p = this.centred(e.clientX, e.clientY);
    // A mouse wheel notch: line mode, or a large vertical step with no
    // horizontal part. Trackpad scrolls come as small pixel steps.
    const isNotch =
      e.deltaMode === WheelEvent.DOM_DELTA_LINE ||
      (e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY));

    if (e.ctrlKey) {
      // Trackpad pinch (and ctrl + wheel).
      e.preventDefault();
      this.zoomAnimate.set(false);
      this.zoom.zoomBy(Math.exp(-e.deltaY * 0.01), p.x, p.y);
    } else if (isNotch) {
      e.preventDefault();
      this.zoomAnimate.set(true);
      this.zoom.zoomBy(e.deltaY < 0 ? 1.25 : 1 / 1.25, p.x, p.y);
      if (this.zoom.scale() < 1.05) this.zoom.reset();
    } else if (this.zoom.isZoomed()) {
      // Two-finger trackpad scroll pans the zoomed photo.
      e.preventDefault();
      this.zoomAnimate.set(false);
      this.zoom.panBy(-e.deltaX, -e.deltaY);
    }
  }
}
