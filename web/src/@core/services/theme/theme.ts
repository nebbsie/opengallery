import { DOCUMENT, inject, Injectable, signal } from '@angular/core';

export type ThemeMode = 'light' | 'dark' | 'system';

// Theme preference. 'light' and 'dark' are stored in localStorage under
// `theme`. 'system' is the absence of that key: the page then follows the OS
// setting, live, through a matchMedia listener. index.html applies the same
// rule before Angular boots, without a write, so "System" stays "System".
@Injectable({ providedIn: 'root' })
export class Theme {
  private readonly key = 'theme';
  private readonly document = inject(DOCUMENT);

  // The stored preference.
  readonly mode = signal<ThemeMode>(this.readMode());
  // The theme on screen now.
  readonly resolved = signal<'light' | 'dark'>('light');

  private media: MediaQueryList | null = null;
  private readonly onSystemChange = () => {
    if (this.mode() === 'system') this.apply();
  };

  set(mode: ThemeMode = 'system') {
    if (typeof this.document === 'undefined' || typeof window === 'undefined') return; // SSR guard

    try {
      if (mode === 'system') {
        window.localStorage.removeItem(this.key);
      } else {
        window.localStorage.setItem(this.key, mode);
      }
    } catch {
      // Storage can be blocked (private mode). The theme still applies for this visit.
    }

    this.mode.set(mode);
    this.listen();
    this.apply();
  }

  // The stored preference ('system' when nothing is stored).
  get(): ThemeMode {
    return this.readMode();
  }

  toggle() {
    this.set(this.resolved() === 'dark' ? 'light' : 'dark');
  }

  private readMode(): ThemeMode {
    if (typeof window === 'undefined') return 'system';
    try {
      const saved = window.localStorage.getItem(this.key);
      if (saved === 'dark' || saved === 'light') return saved;
    } catch {
      // Ignore blocked storage.
    }
    return 'system';
  }

  private listen() {
    if (this.media || typeof window === 'undefined' || !window.matchMedia) return;
    this.media = window.matchMedia('(prefers-color-scheme: dark)');
    this.media.addEventListener('change', this.onSystemChange);
  }

  private apply() {
    const mode = this.mode();
    const dark =
      mode === 'dark' ||
      (mode === 'system' && (this.media?.matches ?? window.matchMedia?.('(prefers-color-scheme: dark)').matches));
    const root = this.document.documentElement;
    root.classList.toggle('dark', !!dark);
    root.style.colorScheme = dark ? 'dark' : 'light';
    this.resolved.set(dark ? 'dark' : 'light');
  }
}
