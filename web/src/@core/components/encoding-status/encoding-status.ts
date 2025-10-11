import { ChangeDetectionStrategy, Component, computed, OnDestroy, signal } from '@angular/core';
import { injectTrpc } from '@core/services/trpc';
/* removed close button */
type QueueCounts = {
  waiting: number;
  active: number;
  delayed: number;
  paused: number;
  completed: number;
  failed: number;
};

@Component({
  selector: 'app-encoding-status',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  host: {
    class: 'block w-full transition-opacity',
  },
  template: `
    @if (visible()) {
      <p class="text-muted-foreground border-t pt-2 text-xs">{{ total() }} files being imported</p>
    }
  `,
})
export class EncodingStatusComponent implements OnDestroy {
  private readonly trpc = injectTrpc();

  private intervalId: ReturnType<typeof setInterval> | undefined;
  counts = signal<null | { counts: QueueCounts; totalPending: number }>(null);
  visible = signal(false);

  active = computed(() => this.counts()?.counts.active ?? 0);
  waiting = computed(() => this.counts()?.counts.waiting ?? 0);
  total = computed(() => this.counts()?.totalPending ?? this.active() + this.waiting());

  constructor() {
    this.startPolling();
  }

  private startPolling() {
    const poll = async () => {
      try {
        const data = await this.trpc.queue.encodingCounts.query();
        this.counts.set(data);
        const pending = data.totalPending > 0;
        this.visible.set(pending);
      } catch {
        // network/auth errors: hide but keep polling
        this.visible.set(false);
      }
    };

    void poll();
    this.intervalId = setInterval(poll, 5_000);
  }

  ngOnDestroy() {
    if (this.intervalId) clearInterval(this.intervalId);
  }
}
