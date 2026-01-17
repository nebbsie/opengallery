import { extname } from 'node:path';

export type MediaType = 'image' | 'video';

export const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tiff']);
export const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'flv']);
export const ALLOWED_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS]);

export function getMediaType(ext: string): MediaType | null {
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  return null;
}

export function isSupportedFile(name: string): boolean {
  const ext = extname(name).slice(1).toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext);
}
