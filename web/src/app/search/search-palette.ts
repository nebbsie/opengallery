import { CdkTrapFocus } from '@angular/cdk/a11y';
import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import { SearchBox } from './search-box';
import { SearchState } from './search-state';

// Desktop search: a panel at the top of the screen with the search field and
// its suggestions. Opened by the search button in the side rail, by "/" or by
// Ctrl+K / Cmd+K. On the /search page (and on small screens, where the rail is
// hidden) the same keys focus the field on the search page instead.
@Component({
  selector: 'app-search-palette',
  imports: [SearchBox, CdkTrapFocus],
  template: `
    @if (state.paletteOpen()) {
      <div
        class="motion-safe:animate-in motion-safe:fade-in-0 fixed inset-0 z-50 bg-black/30 backdrop-blur-[3px]"
        aria-hidden="true"
        (click)="state.closePalette()"
      ></div>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        cdkTrapFocus
        class="glass-strong text-popover-foreground motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-2 fixed top-[12vh] left-1/2 z-50 w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 rounded-3xl p-2"
        (keydown.escape)="state.closePalette()"
      >
        <app-search-box
          [inline]="true"
          [autofocus]="true"
          (navigated)="state.closePalette()"
          (escaped)="state.closePalette()"
        />
        <p class="text-muted-foreground hidden px-3 pt-2 pb-1 text-xs sm:block">
          Try a name, a place, an album, a camera or a year, such as "Steve 2019".
          <kbd class="bg-muted ml-1 rounded px-1 font-sans">↑</kbd>
          <kbd class="bg-muted rounded px-1 font-sans">↓</kbd> to move,
          <kbd class="bg-muted rounded px-1 font-sans">Enter</kbd> to open.
        </p>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchPalette {
  protected readonly state = inject(SearchState);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);

  constructor() {
    const onKey = (event: KeyboardEvent) => this.onGlobalKey(event);
    this.document.addEventListener('keydown', onKey);
    inject(DestroyRef).onDestroy(() => this.document.removeEventListener('keydown', onKey));

    // Focus goes back to the element that opened the palette when it closes.
    let opener: HTMLElement | null = null;
    effect(() => {
      const open = this.state.paletteOpen();
      untracked(() => {
        if (open) {
          opener = this.document.activeElement as HTMLElement | null;
        } else if (opener) {
          if (opener.isConnected) opener.focus();
          opener = null;
        }
      });
    });
  }

  private onGlobalKey(event: KeyboardEvent) {
    const isSlash = event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey;
    const isCmdK = (event.key === 'k' || event.key === 'K') && (event.ctrlKey || event.metaKey);
    if (!isSlash && !isCmdK) return;
    if (isSlash && isEditable(event.target)) return;
    if (this.state.paletteOpen()) return;
    // The photo viewer owns its own keys.
    if (this.router.url.startsWith('/asset/')) return;

    event.preventDefault();
    const onSearchPage = this.router.url.startsWith('/search');
    const wide = this.document.defaultView?.matchMedia('(min-width: 640px)').matches ?? true;
    if (onSearchPage) {
      this.state.requestFocus();
    } else if (wide) {
      this.state.openPalette();
    } else {
      void this.router.navigate(['/search']);
    }
  }
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
