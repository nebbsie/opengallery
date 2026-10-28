import { extname } from 'node:path';

export type MediaType = 'image' | 'video';

export const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tiff']);
// Camera RAW. Imported as photos: a RAW with a photo of the same name in the
// same folder becomes that photo's hidden companion (API utils/raw-pairing.ts),
// a RAW on its own shows through its embedded JPEG preview (utils/raw.ts).
export const RAW_EXTENSIONS = new Set([
  'rw2', 'nef', 'cr2', 'cr3', 'arw', 'dng', 'raf', 'orf', 'pef', 'srw',
]);
export const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'flv']);
export const ALLOWED_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  ...RAW_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
]);

const RAW_MIME: Record<string, string> = {
  rw2: 'image/x-panasonic-rw2',
  nef: 'image/x-nikon-nef',
  cr2: 'image/x-canon-cr2',
  cr3: 'image/x-canon-cr3',
  arw: 'image/x-sony-arw',
  dng: 'image/x-adobe-dng',
  raf: 'image/x-fuji-raf',
  orf: 'image/x-olympus-orf',
  pef: 'image/x-pentax-pef',
  srw: 'image/x-samsung-srw',
};

export function getMediaType(ext: string): MediaType | null {
  if (IMAGE_EXTENSIONS.has(ext) || RAW_EXTENSIONS.has(ext)) return 'image';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  return null;
}

// Mime type stored for a RAW extension (lowercase, no dot), or null.
export function rawMime(ext: string): string | null {
  return RAW_MIME[ext] ?? null;
}

export function isRawName(name: string): boolean {
  return RAW_EXTENSIONS.has(extname(name).slice(1).toLowerCase());
}

export function isSupportedFile(name: string): boolean {
  const ext = extname(name).slice(1).toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext);
}

// Base names (lowercase, no extension) of the non-RAW photos in a folder
// listing. A RAW whose base name is in it pairs with that photo and becomes a
// hidden companion (API utils/raw-pairing.ts), so it is never hashed: its hash
// is not used, and hashing every RAW reads gigabytes off the media drive.
export function photoStems(names: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const n of names) {
    const ext = extname(n).slice(1).toLowerCase();
    if (IMAGE_EXTENSIONS.has(ext)) out.add(n.slice(0, n.length - ext.length - 1).toLowerCase());
  }
  return out;
}

export function rawHasPhotoPartner(name: string, stems: Set<string>): boolean {
  if (!isRawName(name)) return false;
  const ext = extname(name);
  return stems.has(name.slice(0, name.length - ext.length).toLowerCase());
}
