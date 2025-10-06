import type { AppRouter } from '@opengallery/types';
import { createTRPCProxyClient, httpLink } from '@trpc/client';
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import superjson from 'superjson';

const API_URL = process.env['API_URL'];

export const trpc = createTRPCProxyClient<AppRouter>({
  links: [
    httpLink({
      url: `${API_URL}/trpc`,
      transformer: superjson,
      async headers() {
        return {
          authorization: `Bearer ${process.env['INTERNAL_TOKEN']}`,
        };
      },
    }),
  ],
});

export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;
