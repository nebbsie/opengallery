// Formats the worker can import (worker/src/utils/media-types.ts). The server
// checks the real bytes; this only filters out obvious non-media files (for
// example the extra files in a picked folder).
// Camera RAW files. Browsers often give them no mime type.
export const RAW_EXTENSIONS = ['rw2', 'nef', 'cr2', 'cr3', 'arw', 'dng', 'raf', 'orf', 'pef', 'srw'];

const MEDIA_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tiff', 'tif',
  'mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'flv', 'm4v',
  ...RAW_EXTENSIONS,
]);

// For <input type="file" accept>: "image/*" alone hides RAW files in some
// pickers.
export const MEDIA_ACCEPT = ['image/*', 'video/*', ...RAW_EXTENSIONS.map((e) => `.${e}`)].join(',');

export function isMediaFile(file: File): boolean {
  // Hidden files, such as the "._IMG_0001.jpg" files macOS leaves in folders.
  if (file.name.startsWith('.')) return false;
  if (file.type.startsWith('image/') || file.type.startsWith('video/')) return true;
  const dot = file.name.lastIndexOf('.');
  return dot > 0 && MEDIA_EXTENSIONS.has(file.name.slice(dot + 1).toLowerCase());
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return 'no';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || Number.isInteger(v) ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}
