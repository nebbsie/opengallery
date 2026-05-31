import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ErrorAlert } from '@core/components/error/error';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { HlmButton } from '@spartan-ng/helm/button';
import { injectMutation, QueryClient } from '@tanstack/angular-query-experimental';

@Component({
  selector: 'app-settings-locations',
  standalone: true,
  imports: [HlmButton, ErrorAlert],
  template: `
    <div class="min-h-0 flex-1 overflow-y-auto">
      <div>
        <h1 class="text-foreground mb-2 block text-lg font-bold">Locations &amp; Map</h1>
        <p class="text-muted-foreground mb-6 text-sm">
          Photos and videos are placed on the World Map using the GPS coordinates stored in their
          metadata. Files imported before location scanning existed — or that were already encoded —
          may be missing from the map. Run a rescan to read coordinates from your whole library.
        </p>
      </div>

      <div class="mb-10 grid max-w-lg gap-3 rounded-lg border p-3">
        <h2 class="text-foreground font-semibold">Rescan GPS locations</h2>
        <p class="text-muted-foreground text-xs">
          Re-reads GPS coordinates from the original photos and videos and rebuilds the map. This is
          cheap — it does not re-encode anything. Files without GPS data in their metadata simply
          won't appear on the map.
        </p>

        @if (rescanMutation.data(); as r) {
          <p class="text-xs text-green-600">
            Queued {{ r.tasksReset + r.tasksCreated }} files for GPS rescan. Coordinates will appear
            on the map as scanning completes.
          </p>
        }
        @if (rescanMutation.isError()) {
          <app-error-alert [error]="rescanMutation.error() || undefined" />
        }

        @if (!confirming()) {
          <div>
            <button hlmBtn (click)="confirming.set(true)" [disabled]="rescanMutation.isPending()">
              {{ rescanMutation.isPending() ? 'Rescanning…' : 'Rescan GPS locations' }}
            </button>
          </div>
        } @else {
          <div class="flex items-center gap-2">
            <span class="text-sm">Rescan GPS for your whole library?</span>
            <button hlmBtn size="sm" (click)="rescan()">Yes, rescan</button>
            <button hlmBtn variant="ghost" size="sm" (click)="confirming.set(false)">Cancel</button>
          </div>
        }
      </div>
    </div>
  `,
  host: {
    class: 'flex flex-col w-full h-full min-h-0 overflow-hidden',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsLocations {
  private trpc = injectTrpc();
  private queryClient = inject(QueryClient);

  confirming = signal(false);

  rescanMutation = injectMutation(() => ({
    mutationFn: async () => this.trpc.geoLocation.rescanAll.mutate(),
    onSuccess: () => {
      this.confirming.set(false);
      this.queryClient.invalidateQueries({ queryKey: [CacheKey.LocationAll] });
    },
  }));

  rescan() {
    this.rescanMutation.mutate();
  }
}
