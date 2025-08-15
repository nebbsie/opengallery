import {
  EnvironmentProviders,
  inject,
  InjectionToken,
  makeEnvironmentProviders,
} from '@angular/core';
import { createAuthClient } from 'better-auth/client';

export type AuthClient = ReturnType<typeof createAuthClient>;
export const AUTH_CLIENT = new InjectionToken<AuthClient>('AUTH_CLIENT');

export function provideAuthClient(baseURL: string): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: AUTH_CLIENT,
      useFactory: () => createAuthClient({ baseURL }),
    },
  ]);
}

export function injectAuthClient(): AuthClient {
  return inject(AUTH_CLIENT);
}
