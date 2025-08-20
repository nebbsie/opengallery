import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { ScreenSize } from '@core/services/screen-size/screen-size';

@Injectable({ providedIn: 'root' })
export class Sidebar {
  private readonly screenSize = inject(ScreenSize);
  private readonly platform = inject(PLATFORM_ID);
  private readonly router = inject(Router);

  private readonly sidebarContent = signal<'default' | 'settings'>('default');
  readonly content = this.sidebarContent.asReadonly();

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

    // Initialize sidebar content based on current URL (handles hard reloads)
    this.updateContentForUrl(this.router.url);

    // Update sidebar content on navigation changes
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        const url = event.urlAfterRedirects || event.url;
        this.updateContentForUrl(url);
      }
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

  setContent(value: 'default' | 'settings') {
    this.sidebarContent.set(value);
  }

  private updateContentForUrl(url: string) {
    if (!url) return;
    if (url.startsWith('/settings')) {
      this.sidebarContent.set('settings');
    } else {
      this.sidebarContent.set('default');
    }
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
