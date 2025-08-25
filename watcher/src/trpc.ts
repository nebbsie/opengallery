import type { AppRouter } from '@opengallery/types';
import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import superjson from 'superjson';

const API_URL = process.env['API_URL'];

export const trpc = createTRPCProxyClient<AppRouter>({
  links: [
    httpBatchLink({
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
