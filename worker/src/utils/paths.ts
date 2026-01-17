import { join } from 'node:path';

export function toContainerPath(p: string): string {
  const containerRootPrefix = process.env['HOST_ROOT_PREFIX'];
  return containerRootPrefix && containerRootPrefix.trim() !== ''
    ? p === '/'
      ? containerRootPrefix
      : `${containerRootPrefix}${p}`
    : p;
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
