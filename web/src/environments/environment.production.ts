import { Environment } from './envorinment.types';

// Derive API base URL from the page origin at runtime (no SSR dependency)
// Example: visiting http://192.168.0.50:4321 → API http://192.168.0.50:3219
const apiPort = 3219;
const origin =
  typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.hostname}`
    : 'http://localhost';

export const environment: Environment = {
  environment: 'production',
  api: {
    url: `${origin}:${apiPort}`,
  },
};
