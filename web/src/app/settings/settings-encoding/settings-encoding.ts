import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { ErrorAlert } from '@core/components/error/error';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';

@Component({
  selector: 'app-settings-encoding',
  standalone: true,
  imports: [HlmSpinner, HlmButton, ErrorAlert],
  template: `
    @if (settings.isPending()) {
      <hlm-spinner />
    }

    @if (settings.isError()) {
      <app-error-alert [error]="settings.error() || undefined" />
    }

    @if (settings.isSuccess()) {
      <div>
        <h1 class="text-foreground mb-2 block text-lg font-bold">Encoding Options</h1>
        <p class="text-muted-foreground mb-6 text-sm">Tune background encoding performance.</p>
      </div>

      <div class="hover:bg-accent/50 mb-10 grid max-w-lg gap-3 rounded-lg border p-3">
        <div class="flex items-center justify-between">
          <label for="concurrency" class="text-sm font-bold">Concurrency</label>
          <span class="text-muted-foreground text-sm">{{ concurrency() }}</span>
        </div>
        <input
          id="concurrency"
          type="range"
          min="1"
          max="64"
          [value]="concurrency()"
          (input)="onChange($any($event.target).value)"
        />
        <p class="text-muted-foreground text-xs">Higher values may use more CPU. Default is 5.</p>
        <div>
          <button hlmBtn (click)="save()" [disabled]="saveMutation.isPending()">Save</button>
        </div>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsEncoding {
  private trpc = injectTrpc();
  private queryClient = inject(QueryClient);

  settings = injectQuery(() => ({
    queryKey: [CacheKey.MediaSourcesSettings],
    queryFn: async () => this.trpc.settings.get.query(),
  }));

  concurrency = signal<number>(5);

  constructor() {
    effect(() => {
      const data = this.settings.data();
      if (data?.encodingConcurrency) this.concurrency.set(data.encodingConcurrency);
    });
  }

  onChange(value: string) {
    const n = Number(value);
    if (Number.isFinite(n)) this.concurrency.set(Math.min(64, Math.max(1, n)));
  }

  saveMutation = injectMutation(() => ({
    mutationFn: async (value: number) =>
      this.trpc.settings.update.mutate({ encodingConcurrency: value }),
    onSuccess: (data) => {
      if (data?.encodingConcurrency) this.concurrency.set(data.encodingConcurrency);
      this.queryClient.invalidateQueries({ queryKey: [CacheKey.MediaSourcesSettings] });
    },
  }));

  save() {
    this.saveMutation.mutate(this.concurrency());
  }
}
