import { CacheKey } from '@core/services/cache-key.types';

// Query keys and helpers for the admin "Hide from…" rules (tRPC viewerRules.*).
// Every key starts with CacheKey.ViewerRules, so one invalidation of that
// prefix (here or from the settings pages) refreshes all of them.

export const VIEWER_RULES_KEY = CacheKey.ViewerRules;

export const viewerRulesKeys = {
  viewers: () => [VIEWER_RULES_KEY, 'viewers'] as const,
  person: (personId: string) => [VIEWER_RULES_KEY, 'person', personId] as const,
  file: (fileId: string) => [VIEWER_RULES_KEY, 'file', fileId] as const,
};

// Declared locally so templates stay typed even when the tRPC router type
// resolves to `any` in the production build.
export interface Viewer {
  id: string;
  name: string;
  email: string;
}

export interface FileRules {
  hiddenFromUserIds: string[];
  hiddenViaPerson: { userId: string; personName: string | null }[];
}

/** "Sarah", "Sarah and Tom", "Sarah, Tom and Ann", "Sarah, Tom and 3 others". */
export function joinNames(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length <= 3) {
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} others`;
}
