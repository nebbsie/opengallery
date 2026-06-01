// Single source of truth for the thumbnail-grid layout, shared by the live
// virtual grid and its loading skeleton so the skeleton lays out pixel-for-pixel
// like the real content — no shift when data arrives.

/** Gap between tiles in px (Tailwind gap-2). */
export const GRID_GAP_PX = 8;

/** Leading year-header row height in px. */
export const YEAR_HEADER_HEIGHT = 52;

/** Month-header row height in px. */
export const MONTH_HEADER_HEIGHT = 36;

/**
 * Column count for a given container width. Mirrors the breakpoints used by the
 * virtual grid: a minimum tile of 100/160/200px below 640 / 1024 / above.
 */
export function gridColumnsForWidth(width: number): number {
  if (width <= 0) return 1;
  const min = width < 640 ? 100 : width < 1024 ? 160 : 200;
  return Math.max(1, Math.floor(width / min));
}
