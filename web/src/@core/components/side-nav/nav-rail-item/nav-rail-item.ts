import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { PrefetchRouteDirective } from '@core/directives/prefetch-route/prefetch-route.directive';
import { NgIcon } from '@ng-icons/core';
import { HlmIcon } from '@spartan-ng/helm/icon';

// One row in the side rail. The icon lives in a fixed 64px box so it never moves
// as the rail expands; the label sits to its right and fades in once the parent
// panel (which carries the `group/nav` class) is hovered. Active state is a
// filled accent row plus a high-contrast left bar — strictly monochrome.
@Component({
  selector: 'app-nav-rail-item',
  imports: [RouterLink, RouterLinkActive, PrefetchRouteDirective, NgIcon, HlmIcon],
  template: `
    <a
      [routerLink]="link()"
      flPrefetchRoute
      routerLinkActive="bg-accent text-foreground font-semibold"
      #rla="routerLinkActive"
      [routerLinkActiveOptions]="{ exact: exact() }"
      [attr.aria-label]="label()"
      (click)="clicked.emit()"
      class="text-muted-foreground hover:text-foreground hover:bg-accent/50 relative flex h-10 w-full items-center rounded-lg transition-colors"
    >
      @if (rla.isActive) {
        <span
          class="bg-foreground absolute top-1/2 left-0 h-5 w-1 -translate-y-1/2 rounded-r-full"
          aria-hidden="true"
        ></span>
      }
      <span class="grid w-16 shrink-0 place-items-center">
        <span class="relative grid place-items-center">
          <ng-icon hlm size="sm" [name]="icon()" />
          @if (badge() > 0) {
            <span
              class="bg-foreground text-background absolute -top-1.5 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold"
            >
              {{ badge() > 99 ? '99+' : badge() }}
            </span>
          }
        </span>
      </span>
      <span
        class="translate-x-1 text-sm whitespace-nowrap opacity-0 transition-all duration-200 group-hover/nav:translate-x-0 group-hover/nav:opacity-100"
      >
        {{ label() }}
      </span>
    </a>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NavRailItem {
  readonly icon = input.required<string>();
  readonly label = input.required<string>();
  readonly link = input.required<string>();
  readonly exact = input(false);
  readonly badge = input(0);
  readonly clicked = output<void>();
}
