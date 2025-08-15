import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { routes } from './app.routes';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { provideTrpcClient } from '@core/services/trpc';
import { provideHttpClient, withFetch } from '@angular/common/http';
import {
  provideTanStackQuery,
  QueryClient,
  withDevtools,
} from '@tanstack/angular-query-experimental';
import { provideAuthClient } from '@core/services/auth/auth-client';
import { environment } from '@env/environment';

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
    provideAuthClient(environment.api.url),
  ],
};
