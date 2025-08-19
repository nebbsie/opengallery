import { Injectable, effect, inject, signal, PLATFORM_ID } from '@angular/core';
import { ScreenSize } from '@core/services/screen-size/screen-size';
import { isPlatformBrowser } from '@angular/common';

@Injectable({ providedIn: 'root' })
export class Sidebar {
  private readonly screenSize = inject(ScreenSize);
  private readonly platform = inject(PLATFORM_ID);

  private readonly isOpenSignal = signal<boolean>(true);
  readonly isOpen = this.isOpenSignal.asReadonly();

  constructor() {
    const stored = this.readFromStorage();
    if (stored !== null) {
      this.isOpenSignal.set(stored);
    } else {
      // Default on first run: open on sm+, closed on mobile
      this.isOpenSignal.set(this.screenSize.isSmUp());
    }

    effect(() => {
      this.writeToStorage(this.isOpenSignal());
    });
  }

  open() {
    this.isOpenSignal.set(true);
  }

  close() {
    this.isOpenSignal.set(false);
  }

  toggle() {
    this.isOpenSignal.update((value) => !value);
  }

  private canUseStorage(): boolean {
    return isPlatformBrowser(this.platform);
  }

  private readFromStorage(): boolean | null {
    if (!this.canUseStorage()) return null;
    try {
      const raw = window.localStorage.getItem('sidebar.isOpen');
      if (raw === null) return null;
      return raw === 'true';
    } catch {
      return null;
    }
  }

  private writeToStorage(value: boolean): void {
    if (!this.canUseStorage()) return;
    try {
      window.localStorage.setItem('sidebar.isOpen', String(value));
    } catch {
      // ignore storage failures
    }
  }
}
