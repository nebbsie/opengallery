import { Environment } from './envorinment.types';

// Production: API is served via nginx reverse proxy at /api path
// better-auth client automatically appends /api/auth to baseURL
const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4321';

export const environment: Environment = {
  environment: 'production',
  api: {
    url: `${origin}/api`,
    authUrl: origin,
  },
};
