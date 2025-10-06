import { DOCUMENT, inject, Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class Theme {
  private key = 'theme';

  private document = inject(DOCUMENT);

  set(mode: 'light' | 'dark' | 'system' = 'system') {
    const hasDocument = typeof this.document !== 'undefined';
    const hasWindow = typeof window !== 'undefined';
    if (!hasDocument) return; // SSR guard

    const root = this.document.documentElement;
    if (mode === 'system') {
      if (hasWindow && 'localStorage' in window) {
        window.localStorage.removeItem(this.key);
      }
      const prefersDark = hasWindow
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
        : false;
      root.classList.toggle('dark', prefersDark);
      root.style.colorScheme = prefersDark ? 'dark' : 'light';
      return;
    }

    root.classList.toggle('dark', mode === 'dark');
    root.style.colorScheme = mode === 'dark' ? 'dark' : 'light';

    if (hasWindow && 'localStorage' in window) {
      window.localStorage.setItem(this.key, mode);
    }
  }

  get(): 'dark' | 'light' {
    const hasWindow = typeof window !== 'undefined';
    if (!hasWindow) return 'light'; // SSR default

    const saved = window.localStorage.getItem(this.key) as 'dark' | 'light' | null;
    if (saved === 'dark' || saved === 'light') return saved;

    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
  }

  toggle() {
    const hasDocument = typeof this.document !== 'undefined';
    if (!hasDocument) return; // SSR guard
    this.set(this.document.documentElement.classList.contains('dark') ? 'light' : 'dark');
  }
}
