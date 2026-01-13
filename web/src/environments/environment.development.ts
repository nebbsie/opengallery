import { Environment } from './envorinment.types';

// Dev mode: API runs directly on port 3000 (no nginx proxy)
// better-auth client automatically appends /api/auth to baseURL
export const environment: Environment = {
  environment: 'development',
  api: {
    url: 'http://localhost:3000',
  },
};
