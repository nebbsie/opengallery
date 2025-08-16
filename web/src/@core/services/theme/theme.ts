import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class Theme {
  private key = 'theme';

  set(mode: 'light' | 'dark' | 'system' = 'system') {
    const root = document.documentElement;
    if (mode === 'system') {
      localStorage.removeItem(this.key);
      const prefersDark = matchMedia('(prefers-color-scheme: dark)').matches;
      root.classList.toggle('dark', prefersDark);
      root.style.colorScheme = prefersDark ? 'dark' : 'light';

      return;
    }

    root.classList.toggle('dark', mode === 'dark');
    root.style.colorScheme = mode === 'dark' ? 'dark' : 'light';

    localStorage.setItem(this.key, mode);
  }

  toggle() {
    console.log('Toggling theme');
    this.set(document.documentElement.classList.contains('dark') ? 'light' : 'dark');
  }
}
