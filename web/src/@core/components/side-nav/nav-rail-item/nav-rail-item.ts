import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { PrefetchRouteDirective } from '@core/directives/prefetch-route/prefetch-route.directive';
import { NgIcon } from '@ng-icons/core';
import { BrnTooltipImports } from '@spartan-ng/brain/tooltip';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmTooltipImports } from '@spartan-ng/helm/tooltip';

// One row in the slim icon rail: a centered icon with the label shown as a
// tooltip on hover. Active state is a filled accent row plus a high-contrast
// left bar — strictly monochrome.
@Component({
  selector: 'app-nav-rail-item',
  imports: [
    RouterLink,
    RouterLinkActive,
    PrefetchRouteDirective,
    NgIcon,
    HlmIcon,
    HlmTooltipImports,
    BrnTooltipImports,
  ],
  template: `
    <hlm-tooltip>
      <a
        hlmTooltipTrigger
        position="right"
        [routerLink]="link()"
        flPrefetchRoute
        routerLinkActive="bg-accent text-foreground"
        #rla="routerLinkActive"
        [routerLinkActiveOptions]="{ exact: exact() }"
        [attr.aria-label]="label()"
        (click)="clicked.emit()"
        class="text-muted-foreground hover:text-foreground hover:bg-accent/50 relative flex h-10 w-full items-center justify-center rounded-lg transition-colors"
      >
        @if (rla.isActive) {
          <span
            class="bg-foreground absolute top-1/2 left-0 h-5 w-1 -translate-y-1/2 rounded-r-full"
            aria-hidden="true"
          ></span>
        }
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
      </a>
      <span *brnTooltipContent>{{ label() }}</span>
    </hlm-tooltip>
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
