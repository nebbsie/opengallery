import { Injectable } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { injectTrpcClient } from '@core/services/trpc';

@Injectable({
  providedIn: 'root',
})
export class Health {
  private readonly trpc = injectTrpcClient();

  get() {
    return injectQuery(() => ({
      queryKey: ['health'],
      queryFn: async () => this.trpc.health.check.query(),
      staleTime: 5000,
    }));
  }
}
