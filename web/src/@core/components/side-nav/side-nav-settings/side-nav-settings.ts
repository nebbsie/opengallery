import { ChangeDetectionStrategy, Component, computed, output } from '@angular/core';
import { NavRailItem } from '@core/components/side-nav/nav-rail-item/nav-rail-item';
import { injectTrpc } from '@core/services/trpc';
import { injectQuery } from '@tanstack/angular-query-experimental';

interface SettingsGroup {
  label: string;
  items: { icon: string; label: string; link: string; badgeKey?: 'tasks' }[];
}

@Component({
  selector: 'app-side-nav-settings',
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
          [exact]="true"
          [badge]="item.badgeKey === 'tasks' ? pendingCount() : 0"
          (clicked)="clicked.emit()"
        />
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SideNavSettings {
  clicked = output<void>();

  private readonly trpc = injectTrpc();

  private readonly queueCounts = injectQuery(() => ({
    queryKey: ['queue', 'encodingCounts'],
    queryFn: () => this.trpc.queue.encodingCounts.query(),
    refetchInterval: 10_000,
  }));

  pendingCount = computed(() => this.queueCounts.data()?.totalPending ?? 0);

  protected readonly groups: SettingsGroup[] = [
    {
      label: 'Account',
      items: [
        { icon: 'lucideUser', label: 'Profile', link: '/settings/profile' },
        { icon: 'lucideMonitor', label: 'UI', link: '/settings/ui' },
        { icon: 'lucideUsers', label: 'Users', link: '/settings/users' },
      ],
    },
    {
      label: 'Library',
      items: [
        { icon: 'lucideHardDrive', label: 'Source Folders', link: '/settings/sources' },
        { icon: 'lucideActivity', label: 'Encoding', link: '/settings/encoding' },
        { icon: 'lucideScanFace', label: 'Faces', link: '/settings/faces' },
        { icon: 'lucideMapPin', label: 'Locations', link: '/settings/locations' },
        { icon: 'lucideDatabase', label: 'Storage', link: '/settings/storage' },
        { icon: 'lucideCopy', label: 'Duplicates', link: '/settings/duplicates' },
      ],
    },
    {
      label: 'System',
      items: [
        { icon: 'lucideListChecks', label: 'Tasks', link: '/settings/tasks', badgeKey: 'tasks' },
        { icon: 'lucideBadgeAlert', label: 'Issues', link: '/settings/issues' },
        { icon: 'lucideLogs', label: 'Logs', link: '/settings/logs' },
      ],
    },
  ];
}
