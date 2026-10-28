import { Injectable, computed, signal } from '@angular/core';

/** What the selection bar needs to know about one selected item. */
export interface SelectedItemInfo {
  id: string;
  type: 'image' | 'video';
}

/**
 * Multi-select state for one photo grid page.
 *
 * Opt in by adding `providers: [GridSelection]` to the page component and
 * putting `<app-selection-bar />` in its template. Every `app-asset-thumbnail`
 * and `app-virtual-thumbnail-grid` under that page then shows check circles,
 * long-press, shift-click ranges, drag-select and per-date select-all. Pages
 * that do not provide it keep the old click-to-open behaviour.
 *
 * Holds ids only (a Set in a signal), so the cost does not grow with the
 * library: only the rendered tiles read it.
 */
@Injectable()
export class GridSelection {
  private readonly _ids = signal<ReadonlySet<string>>(new Set());
  readonly ids = this._ids.asReadonly();
  readonly count = computed(() => this._ids().size);
  readonly active = computed(() => this._ids().size > 0);

  /** Last item toggled by hand; the start of a shift-click range. */
  private anchor: string | null = null;
  private suppressUntil = 0;

  /** The grid registers the item order so ranges can be resolved. */
  private orderProvider: (() => readonly string[]) | null = null;
  private infoProvider: ((id: string) => SelectedItemInfo | null) | null = null;

  register(
    order: () => readonly string[],
    info: (id: string) => SelectedItemInfo | null,
  ): void {
    this.orderProvider = order;
    this.infoProvider = info;
  }

  isSelected(id: string): boolean {
    return this._ids().has(id);
  }

  toggle(id: string): void {
    const next = new Set(this._ids());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.anchor = id;
    this._ids.set(next);
  }

  setMany(ids: Iterable<string>, selected: boolean): void {
    const next = new Set(this._ids());
    for (const id of ids) {
      if (selected) next.add(id);
      else next.delete(id);
    }
    this._ids.set(next);
  }

  replace(ids: ReadonlySet<string>): void {
    this._ids.set(ids);
  }

  /** Shift-click: select everything between the anchor and `id`. */
  selectRangeTo(id: string): void {
    const order = this.orderProvider?.() ?? [];
    const from = this.anchor ? order.indexOf(this.anchor) : -1;
    const to = order.indexOf(id);
    if (from < 0 || to < 0) {
      this.toggle(id);
      return;
    }
    const [a, b] = from < to ? [from, to] : [to, from];
    this.setMany(order.slice(a, b + 1), true);
    this.anchor = id;
  }

  hasAnchor(): boolean {
    return this.anchor !== null;
  }

  setAnchor(id: string): void {
    this.anchor = id;
  }

  clear(): void {
    this.anchor = null;
    if (this._ids().size) this._ids.set(new Set());
  }

  /** Swallow the click that follows a long-press or a drag. */
  suppressNextClick(ms = 400): void {
    this.suppressUntil = Date.now() + ms;
  }

  consumeSuppressedClick(): boolean {
    if (Date.now() < this.suppressUntil) {
      this.suppressUntil = 0;
      return true;
    }
    return false;
  }

  /** Selected items with their type, in grid order where known. */
  selectedInfo(): SelectedItemInfo[] {
    const ids = this._ids();
    const out: SelectedItemInfo[] = [];
    for (const id of ids) {
      out.push(this.infoProvider?.(id) ?? { id, type: 'image' });
    }
    return out;
  }
}
