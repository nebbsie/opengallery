import { ChangeDetectionStrategy, Component, output } from '@angular/core';
import { NavRailItem } from '@core/components/side-nav/nav-rail-item/nav-rail-item';

interface NavGroup {
  label: string;
  items: { icon: string; label: string; link: string; exact?: boolean }[];
}

@Component({
  selector: 'app-side-nav-default',
  imports: [NavRailItem],
  host: { class: 'flex flex-col gap-0.5' },
  template: `
    @for (group of groups; track group.label) {
      <div class="flex h-7 items-center px-4">
        <span
          class="text-muted-foreground/70 translate-x-1 text-[10px] font-semibold tracking-wider uppercase opacity-0 transition-all duration-200 group-hover/nav:translate-x-0 group-hover/nav:opacity-100"
        >
          {{ group.label }}
        </span>
      </div>
      @for (item of group.items; track item.link) {
        <app-nav-rail-item
          [icon]="item.icon"
          [label]="item.label"
          [link]="item.link"
          [exact]="item.exact ?? false"
          (clicked)="clicked.emit()"
        />
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SideNavDefault {
  clicked = output<void>();

  protected readonly groups: NavGroup[] = [
    {
      label: 'Library',
      items: [
        { icon: 'lucideLayoutDashboard', label: 'All', link: '/gallery', exact: true },
        { icon: 'lucideImage', label: 'Photos', link: '/gallery/photos' },
        { icon: 'lucideFilm', label: 'Videos', link: '/gallery/videos' },
      ],
    },
    {
      label: 'Browse',
      items: [
        { icon: 'lucideUsers', label: 'People', link: '/faces' },
        { icon: 'lucideImages', label: 'Albums', link: '/albums' },
        { icon: 'lucideCalendar', label: 'Years', link: '/years' },
        { icon: 'lucideCamera', label: 'Cameras', link: '/cameras' },
        { icon: 'lucideMap', label: 'World Map', link: '/map' },
      ],
    },
  ];
}
