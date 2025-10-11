import { computed, inject, Injectable } from '@angular/core';
import { Auth } from '@core/services/auth/auth';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';

@Injectable({ providedIn: 'root' })
export class UiSettingsService {
  private readonly trpc = injectTrpc();
  private readonly queryClient = inject(QueryClient);
  private readonly auth = inject(Auth);

  // Fetch UI settings once and cache
  private readonly uiSettingsQuery = injectQuery(() => ({
    queryKey: [CacheKey.UiSettings],
    queryFn: async () => this.trpc.uiSettings.get.query(),
    // Only fetch when auth is initialized and the user is authenticated
    enabled: this.auth.ready() && this.auth.isAuthenticated(),
    staleTime: Infinity,
  }));

  isPending = () => this.uiSettingsQuery.isPending();
  isError = () => this.uiSettingsQuery.isError();
  error = () => this.uiSettingsQuery.error();

  autoCloseSidebarOnAssetOpen = computed<null | boolean>(() => {
    const data = this.uiSettingsQuery.data();
    return data?.autoCloseSidebarOnAssetOpen ?? null; // null until loaded
  });

  async setAutoCloseSidebarOnAssetOpen(value: boolean): Promise<void> {
    await this.trpc.uiSettings.update.mutate({ autoCloseSidebarOnAssetOpen: value });
    this.queryClient.setQueryData([CacheKey.UiSettings], {
      autoCloseSidebarOnAssetOpen: value,
    });
  }
}
