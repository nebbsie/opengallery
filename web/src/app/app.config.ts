import { provideHttpClient, withFetch } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { Auth } from '@core/services/auth/auth';
import { provideBetterAuthClient } from '@core/services/auth/better-auth-client';
import { Theme } from '@core/services/theme/theme';
import { provideTrpcClient } from '@core/services/trpc';
import { environment } from '@env/environment';
import {
  provideTanStackQuery,
  QueryClient,
  withDevtools,
} from '@tanstack/angular-query-experimental';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({
        scrollPositionRestoration: 'enabled',
        anchorScrolling: 'enabled',
      }),
    ),
    provideClientHydration(withEventReplay()),
    provideTrpcClient(),
    provideHttpClient(withFetch()),
    provideTanStackQuery(
      new QueryClient(),
      withDevtools(() => ({ loadDevtools: 'auto' })),
    ),
    provideBetterAuthClient(environment.api.authUrl),
    provideAppInitializer(() => {
      const timer = performance.now();
      // Apply theme before app renders (client-only)
      const theme = inject(Theme);
      if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        theme.set(theme.get());
      }
      inject(Auth).initialize();
      const elapsed = performance.now() - timer;
      console.log(`App initialized in ${elapsed.toFixed(2)} ms`);
    }),
  ],
};
