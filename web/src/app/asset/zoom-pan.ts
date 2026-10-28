import { computed, signal } from '@angular/core';

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;
// The zoom a double tap, double click or "+" key steps to from 1x.
export const TAP_ZOOM = 2.5;

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

// Where an image of natural size (nw x nh) sits inside a viewport of (vw x vh)
// with object-fit: contain. Used for zoom clamping and the face overlay.
export function containRect(vw: number, vh: number, nw: number, nh: number): Rect {
  if (!vw || !vh || !nw || !nh) return { left: 0, top: 0, width: vw, height: vh };
  const k = Math.min(vw / nw, vh / nh);
  const width = nw * k;
  const height = nh * k;
  return { left: (vw - width) / 2, top: (vh - height) / 2, width, height };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Zoom and pan state for one image in the viewer. The image layer gets
 * `translate(x, y) scale(scale)` with transform-origin at the viewport centre,
 * so no layout changes happen. Points passed in are relative to the viewport
 * centre, in CSS pixels.
 */
export class ZoomPan {
  readonly scale = signal(1);
  readonly x = signal(0);
  readonly y = signal(0);
  readonly isZoomed = computed(() => this.scale() > 1.01);
  readonly transform = computed(
    () => `translate3d(${this.x()}px, ${this.y()}px, 0) scale(${this.scale()})`,
  );

  private vw = 0;
  private vh = 0;
  // Size of the image at 1x (object-contain fit inside the viewport).
  private cw = 0;
  private ch = 0;

  setGeometry(vw: number, vh: number, cw: number, ch: number): void {
    this.vw = vw;
    this.vh = vh;
    this.cw = cw;
    this.ch = ch;
    this.clampPan();
  }

  /** Zoom to `next` and keep the image point under (px, py) in place. */
  zoomTo(next: number, px = 0, py = 0): void {
    const s0 = this.scale();
    const s1 = clamp(next, MIN_ZOOM, MAX_ZOOM);
    if (s1 === s0) return;
    const k = s1 / s0;
    this.x.set(px - (px - this.x()) * k);
    this.y.set(py - (py - this.y()) * k);
    this.scale.set(s1);
    this.clampPan();
  }

  zoomBy(factor: number, px = 0, py = 0): void {
    this.zoomTo(this.scale() * factor, px, py);
  }

  /** Double tap / double click: zoom in at the point, or back to 1x. */
  toggleAt(px: number, py: number): void {
    if (this.isZoomed()) this.reset();
    else this.zoomTo(TAP_ZOOM, px, py);
  }

  panBy(dx: number, dy: number): void {
    this.x.set(this.x() + dx);
    this.y.set(this.y() + dy);
    this.clampPan();
  }

  reset(): void {
    this.scale.set(1);
    this.x.set(0);
    this.y.set(0);
  }

  // Keep the image edges at or past the viewport edges. When the scaled image
  // is smaller than the viewport on one axis, centre it on that axis.
  private clampPan(): void {
    const s = this.scale();
    const maxX = Math.max(0, (this.cw * s - this.vw) / 2);
    const maxY = Math.max(0, (this.ch * s - this.vh) / 2);
    this.x.set(clamp(this.x(), -maxX, maxX));
    this.y.set(clamp(this.y(), -maxY, maxY));
  }
}
