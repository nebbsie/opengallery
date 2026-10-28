import { Injectable, InjectionToken, Signal, signal } from '@angular/core';

/** Gap between square tiles (tailwind gap-2). */
export const SQUARE_GAP = 8;
/** Gap between tiles in justified rows (tighter, like Google Photos). */
export const JUSTIFIED_GAP = 4;

export const YEAR_HEADER_HEIGHT = 52;
export const MONTH_HEADER_HEIGHT = 40;
export const DAY_HEADER_HEIGHT = 36;

/** Columns for the square layout at a given content width. */
export function squareColumns(width: number): number {
  const min = width < 640 ? 100 : width < 1024 ? 160 : 200;
  return Math.max(1, Math.floor(width / min));
}

/** Square tile edge (px) at a given content width. */
export function squareTileSize(width: number): number {
  const cols = squareColumns(width);
  return Math.max(120, Math.floor((width - (cols - 1) * SQUARE_GAP) / cols));
}

/** Target row height for justified rows at a given content width. */
export function justifiedTargetHeight(width: number): number {
  return width < 640 ? 120 : width < 1024 ? 170 : 220;
}

/**
 * Per-cell context the grid hands to the item template (through the template
 * outlet injector), so a thumbnail knows how it is laid out without each page
 * passing inputs.
 */
export interface GridCellContext {
  /** True when the tile is a justified (aspect kept) cell, not a square. */
  justified: Signal<boolean>;
  /** Approximate rendered tile width in CSS px, for `sizes`. */
  tileWidth: Signal<number>;
}

export const GRID_CELL = new InjectionToken<GridCellContext>('GRID_CELL');

export type GridLayoutMode = 'justified' | 'squares';

const STORAGE_KEY = 'og.gridLayout';

/** The viewer's preferred grid layout, remembered in this browser. */
@Injectable({ providedIn: 'root' })
export class GridLayoutPreference {
  private readonly _mode = signal<GridLayoutMode>(this.read());
  readonly mode = this._mode.asReadonly();

  set(mode: GridLayoutMode): void {
    this._mode.set(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Private mode or blocked storage: keep it for this session only.
    }
  }

  toggle(): void {
    this.set(this._mode() === 'justified' ? 'squares' : 'justified');
  }

  private read(): GridLayoutMode {
    try {
      const v = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
      return v === 'squares' ? 'squares' : 'justified';
    } catch {
      return 'justified';
    }
  }
}
