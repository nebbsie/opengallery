import { Injectable, signal } from '@angular/core';

const RECENT_KEY = 'og.search.recent';
const RETURN_KEY = 'og.search.return';
const MAX_RECENT = 6;

// App-wide search UI state: the desktop search palette, focus requests for the
// search page field, recent searches (per browser), and the query to restore
// when the user comes back to /search from the photo viewer.
@Injectable({ providedIn: 'root' })
export class SearchState {
  readonly paletteOpen = signal(false);
  // Bumped to ask the search page field to take focus.
  readonly focusRequest = signal(0);
  readonly recent = signal<string[]>(this.readRecent());

  openPalette() {
    this.paletteOpen.set(true);
  }

  closePalette() {
    this.paletteOpen.set(false);
  }

  requestFocus() {
    this.focusRequest.update((n) => n + 1);
  }

  remember(query: string) {
    const q = query.trim();
    if (!q) return;
    const next = [q, ...this.recent().filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(0, MAX_RECENT);
    this.recent.set(next);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      // Storage can be blocked. Recent searches then last for this visit only.
    }
  }

  forget(query: string) {
    const next = this.recent().filter((r) => r !== query);
    this.recent.set(next);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      // Ignore blocked storage.
    }
  }

  setReturnQuery(query: string) {
    try {
      sessionStorage.setItem(RETURN_KEY, query);
    } catch {
      // Ignore blocked storage.
    }
  }

  takeReturnQuery(): string | null {
    try {
      return sessionStorage.getItem(RETURN_KEY);
    } catch {
      return null;
    }
  }

  private readRecent(): string[] {
    if (typeof window === 'undefined') return [];
    try {
      const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
      return Array.isArray(raw) ? raw.filter((r): r is string => typeof r === 'string').slice(0, MAX_RECENT) : [];
    } catch {
      return [];
    }
  }
}

// Route for one suggestion. Kept here so the dropdown and the results page
// link to the same places.
export const searchLinks = {
  person: (id: string) => ['/faces', id],
  album: (id: string) => ['/albums', id],
  place: (lat: number, lon: number) => ['/locations', String(lat), String(lon)],
  camera: (make: string, model: string) => ['/cameras', make, model],
  year: (year: number) => ['/years', String(year)],
};
