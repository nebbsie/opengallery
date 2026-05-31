import { Directive, HostListener, inject } from '@angular/core';
import { Location } from '@angular/common';

// Press Escape on a detail page (album, camera, person, location, …) to go back
// a page, mirroring the asset viewer. Attach via `hostDirectives` so a page
// opts in without any template changes.
//
// Ignored when: the event was already handled (defaultPrevented), focus is in a
// text field (Escape there cancels editing), or a dialog/menu/popover overlay
// is open (Escape should close that, not navigate).
@Directive({
  selector: '[flBackOnEscape]',
  standalone: true,
})
export class BackOnEscapeDirective {
  private readonly location = inject(Location);

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (this.isEditable(event.target as HTMLElement | null)) return;
    if (document.querySelector('.cdk-overlay-pane')) return;

    event.preventDefault();
    this.location.back();
  }

  private isEditable(el: HTMLElement | null): boolean {
    if (!el) return false;
    const tag = el.tagName;
    return (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      el.isContentEditable
    );
  }
}
