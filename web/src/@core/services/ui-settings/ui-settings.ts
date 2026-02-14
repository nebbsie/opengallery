import { inject, Injectable } from '@angular/core';
import { Auth } from '@core/services/auth/auth';
import { CacheKey } from '@core/services/cache-key.types';
import { injectQuery } from '@tanstack/angular-query-experimental';

@Injectable({ providedIn: 'root' })
export class UiSettingsService {
  private readonly auth = inject(Auth);

  // Fetch UI settings once and cache (skeleton for future settings)
  private readonly uiSettingsQuery = injectQuery(() => ({
    queryKey: [CacheKey.UiSettings],
    queryFn: async () => ({}),
    enabled: this.auth.ready() && this.auth.isAuthenticated(),
    staleTime: Infinity,
  }));
}
