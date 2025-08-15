import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, InjectionToken } from '@angular/core';
import { environment } from '@env/environment';
import { AppRouter } from '@api/router';
import { createTRPCProxyClient, TRPCClient, TRPCClientError, TRPCLink } from '@trpc/client';
import { catchError, Observable, throwError } from 'rxjs';
import { deserialize, serialize, SuperJSONResult } from 'superjson';
import { TrpcCache } from '@core/services/trpc/trpc-cache';

const TRPC_CLIENT = new InjectionToken<TRPCClient<AppRouter>>('TRPC_CLIENT');

interface AngularLinkOptions {
  url: string;
}

const angularLink = (http: HttpClient, cache: TrpcCache) => {
  return <TRouter extends AppRouter>(opts: AngularLinkOptions): TRPCLink<TRouter> => {
    return () =>
      ({ op }) =>
        new Observable((observer) => {
          const url = `${opts.url}/${op.path}`;
          const headers: Record<string, string> = {};

          // consider input "valid" only if not undefined AND not null
          const isValidInput = typeof op.input !== 'undefined' && op.input !== null;

          // only serialize when valid; keeps query URLs clean and avoids ?input={"json":null}
          const serialized = isValidInput ? serialize(op.input as unknown) : undefined;

          // stable cache key that doesn't stringify "undefined" or "null"
          const cacheKey = `${op.type}:${op.path}:${isValidInput ? JSON.stringify(serialized) : ''}`;

          const handleError = (error: HttpErrorResponse) => {
            observer.error(
              new TRPCClientError(error.error?.message ?? 'TRPC request failed', {
                cause: error,
                result: error.error?.error?.json
                  ? {
                      error: {
                        code: error.error.error.json.data?.code,
                        status: error.error.error.json.data?.httpStatus,
                        message: error.error.error.json.message,
                      },
                    }
                  : undefined,
              }),
            );
            observer.complete();
          };

          switch (op.type) {
            case 'subscription': {
              observer.error(new TRPCClientError('Subscriptions are not supported'));
              observer.complete();
              return;
            }

            case 'query': {
              const cachedResult = cache.get(cacheKey);
              if (cachedResult !== undefined) {
                observer.next({ result: { type: 'data', data: cachedResult } });
                observer.complete();
                return;
              }

              // only add params.input when input is valid
              const options = {
                headers,
                ...(isValidInput ? { params: { input: JSON.stringify(serialized) } } : {}),
              } as const;

              http
                .get<{ result: { data: SuperJSONResult } }>(url, options)
                .pipe(
                  catchError((error: HttpErrorResponse) => {
                    handleError(error);
                    return throwError(() => error);
                  }),
                )
                .subscribe({
                  next: (res) => {
                    const parsedResponse = deserialize(res.result.data);
                    cache.set(cacheKey, parsedResponse);
                    observer.next({ result: { type: 'data', data: parsedResponse } });
                    observer.complete();
                  },
                  // eslint-disable-next-line @typescript-eslint/no-empty-function
                  error: () => {},
                });

              break;
            }

            case 'mutation': {
              // Angular's post requires a body param; use null if input is invalid
              const body = isValidInput ? serialized : null;

              http
                .post<{ result: { data: SuperJSONResult } }>(url, body, { headers })
                .pipe(
                  catchError((error: HttpErrorResponse) => {
                    handleError(error);
                    return throwError(() => error);
                  }),
                )
                .subscribe({
                  next: (res) => {
                    const parsedResponse = deserialize(res.result.data);
                    cache.clear();
                    observer.next({ result: { type: 'data', data: parsedResponse } });
                    observer.complete();
                  },
                  // eslint-disable-next-line @typescript-eslint/no-empty-function
                  error: () => {},
                });
              break;
            }
          }
        });
  };
};

export const provideTrpcClient = () => {
  return {
    provide: TRPC_CLIENT,
    useFactory: (http: HttpClient) =>
      createTRPCProxyClient<AppRouter>({
        links: [
          angularLink(
            http,
            new TrpcCache(),
          )({
            url: `${environment.api.url}/trpc`,
          }),
        ],
      }),
    deps: [HttpClient],
  };
};

export function injectTrpcClient() {
  return inject(TRPC_CLIENT);
}
