import {
  EnvironmentProviders,
  inject,
  InjectionToken,
  makeEnvironmentProviders,
} from '@angular/core';
import { createAuthClient } from 'better-auth/client';

export type BetterAuthClient = ReturnType<typeof createAuthClient>;
export const BETTER_AUTH_CLIENT = new InjectionToken<BetterAuthClient>('BETTER_AUTH_CLIENT');

export function provideBetterAuthClient(baseURL: string): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: BETTER_AUTH_CLIENT,
      useFactory: () => createAuthClient({ baseURL }),
    },
  ]);
}

export function injectBetterAuthClient(): BetterAuthClient {
  return inject(BETTER_AUTH_CLIENT);
}
