import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function toContainerPath(p: string): string {
  const containerRootPrefix = process.env['HOST_ROOT_PREFIX'];
  if (!containerRootPrefix || containerRootPrefix.trim() === '') return p;
  const prefixed = p === '/' ? containerRootPrefix : `${containerRootPrefix}${p}`;
  // A path inside the container itself (the uploads folder under /data) has no
  // host mount. Use it as it is when only that one exists, the same fallback as
  // the API's directory picker.
  if (!existsSync(prefixed) && existsSync(p)) return p;
  return prefixed;
}

export function toHostPath(p: string): string {
  const containerRootPrefix = process.env['HOST_ROOT_PREFIX'];
  return containerRootPrefix && p.startsWith(containerRootPrefix)
    ? p.slice(containerRootPrefix.length) || '/'
    : p;
}

export function getFullPath(dir: string, name: string): string {
  return join(dir, name);
}
