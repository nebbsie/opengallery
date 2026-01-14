import { Environment } from './envorinment.types';

// Default/fallback environment - same as development
// Dev mode: API runs directly on port 3000 (no nginx proxy)
export const environment: Environment = {
  environment: 'development',
  api: {
    url: 'http://localhost:3000',
    authUrl: 'http://localhost:3000',
  },
};
