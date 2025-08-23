import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, InjectionToken } from '@angular/core';
import { BETTER_AUTH_CLIENT, type BetterAuthClient } from '@core/services/auth/better-auth-client';
import { TrpcCache } from '@core/services/trpc/trpc-cache';
import { environment } from '@env/environment';
import type { AppRouter } from '@opengallery/types';
import { createTRPCProxyClient, TRPCClient, TRPCClientError, TRPCLink } from '@trpc/client';
import { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import { Observable } from 'rxjs';
import { deserialize, serialize, SuperJSONResult } from 'superjson';

const TRPC_CLIENT = new InjectionToken<TRPCClient<AppRouter>>('TRPC_CLIENT');

interface AngularLinkOptions {
  url: string;
}

const angularLink = (http: HttpClient, cache: TrpcCache, auth: BetterAuthClient) => {
  return <TRouter extends AppRouter>(opts: AngularLinkOptions): TRPCLink<TRouter> => {
    return () =>
      ({ op }) =>
        new Observable((observer) => {
          const url = `${opts.url}/${op.path}`;
          const headers: Record<string, string> = {};

          headers['Content-Type'] = 'application/json';

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

          const perform = async () => {
            try {
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
                    withCredentials: true,
                    ...(isValidInput ? { params: { input: JSON.stringify(serialized) } } : {}),
                  } as const;

                  const execute = () =>
                    http.get<{ result: { data: SuperJSONResult } }>(url, options);

                  let retried = false;
                  const subscribeOnce = () => {
                    execute().subscribe({
                      next: (res) => {
                        const parsedResponse = deserialize(res.result.data);
                        cache.set(cacheKey, parsedResponse);
                        observer.next({ result: { type: 'data', data: parsedResponse } });
                        observer.complete();
                      },
                      error: async (error: HttpErrorResponse) => {
                        if (!retried && error.status === 401) {
                          retried = true;
                          try {
                            await auth.getSession();
                          } catch {}
                          subscribeOnce();
                          return;
                        }
                        handleError(error);
                      },
                    });
                  };

                  subscribeOnce();

                  break;
                }

                case 'mutation': {
                  const body = isValidInput ? serialized : null;

                  const execute = () =>
                    http.post<{ result: { data: SuperJSONResult } }>(url, body, {
                      headers,
                      withCredentials: true,
                    });

                  let retried = false;
                  const subscribeOnce = () => {
                    execute().subscribe({
                      next: (res) => {
                        const parsedResponse = deserialize(res.result.data);
                        cache.clear();
                        observer.next({ result: { type: 'data', data: parsedResponse } });
                        observer.complete();
                      },
                      error: async (error: HttpErrorResponse) => {
                        if (!retried && error.status === 401) {
                          retried = true;
                          try {
                            await auth.getSession();
                          } catch {}
                          subscribeOnce();
                          return;
                        }
                        handleError(error);
                      },
                    });
                  };

                  subscribeOnce();
                  break;
                }
              }
            } catch (e) {
              handleError(e as HttpErrorResponse);
            }
          };

          void perform();
        });
  };
};

export const provideTrpcClient = () => {
  return {
    provide: TRPC_CLIENT,
    useFactory: (http: HttpClient, auth: BetterAuthClient) =>
      createTRPCProxyClient<AppRouter>({
        links: [
          angularLink(
            http,
            new TrpcCache(),
            auth,
          )({
            url: `${environment.api.url}/trpc`,
          }),
        ],
      }),
    deps: [HttpClient, BETTER_AUTH_CLIENT],
  };
};

export function injectTrpc() {
  return inject(TRPC_CLIENT);
}

export type RouterOutputs = inferRouterOutputs<AppRouter>;
export type RouterInputs = inferRouterInputs<AppRouter>;
