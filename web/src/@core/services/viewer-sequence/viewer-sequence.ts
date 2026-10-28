import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'og.viewer.sequences';
// Keep only the most recent lists; older tokens fall back to library order.
const MAX_LISTS = 5;

type Lists = Record<string, string[]>;

// An ordered list of file ids that the photo viewer walks with prev / next,
// for pages whose order the server cannot rebuild from query params (search
// results). The page puts its list here under a token and passes the token to
// the viewer in the `seq` query param. Without a token (or with an unknown
// one) the viewer keeps its normal library order.
@Injectable({ providedIn: 'root' })
export class ViewerSequence {
  private readonly lists = signal<Lists>(this.read());

  newToken(): string {
    return Math.random().toString(36).slice(2, 10);
  }

  /** Stores (or replaces) the list for a token. */
  set(token: string, ids: string[]): void {
    const cur = this.lists();
    const prev = cur[token];
    if (prev && prev.length === ids.length && prev.every((id, i) => id === ids[i])) return;
    const others = Object.entries(cur).filter(([k]) => k !== token);
    const next = Object.fromEntries([...others.slice(-(MAX_LISTS - 1)), [token, ids]]);
    this.lists.set(next);
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage can be blocked. The list then lasts until a reload.
    }
  }

  /** The list for a token, or null. Reads a signal, so it is reactive. */
  get(token: string | null): string[] | null {
    if (!token) return null;
    return this.lists()[token] ?? null;
  }

  private read(): Lists {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as unknown) : null;
      return parsed && typeof parsed === 'object' ? (parsed as Lists) : {};
    } catch {
      return {};
    }
  }
}
