import exifr from 'exifr';
import type { ExifData } from '../types/exif-data.js';
import { logger } from './logger.js';

/**
 * Safely extract a string from an EXIF field.
 * exifr can return Buffer/Uint8Array for malformed tags; we only keep
 * printable, non-empty strings.
 */
function safeString(val: unknown): string | null {
  if (val == null) return null;
  const str =
    typeof val === 'string'
      ? val
      : val instanceof Uint8Array || Buffer.isBuffer(val)
        ? ''
        : String(val);
  if (!str) return null;
  // Reject strings that are mostly non-printable / control characters
  const printable = str.replace(/[^\x20-\x7E]/g, '');
  return printable.trim().length > 0 ? printable.trim() : null;
}

// Placeholder dates that cameras and muxers write when no clock was set:
// 1970-01-01 (Unix epoch) and 1904-01-01 (QuickTime epoch).
const ZERO_EPOCHS = new Set([0, Date.UTC(1904, 0, 1)]);

/**
 * True for a capture date worth storing. Rejects invalid dates, the zero
 * epochs above, and the 1899 date that exifr makes from "0000:00:00 00:00:00"
 * (JS maps year 0 to 1900 and month 0 rolls back one month).
 */
export function isPlausibleDate(d: Date): boolean {
  const t = d.getTime();
  if (isNaN(t)) return false;
  // exifr builds EXIF dates in local time, so also compare the wall clock.
  const wallClock = t - d.getTimezoneOffset() * 60_000;
  if (ZERO_EPOCHS.has(t) || ZERO_EPOCHS.has(wallClock)) return false;
  if (d.getFullYear() < 1900) return false;
  return t <= Date.now() + 24 * 60 * 60 * 1000;
}

export async function getExifInfo(path: string): Promise<{
  takenAt: Date | undefined;
  lat: number | undefined;
  lon: number | undefined;
  cameraMake?: string | null;
  cameraModel?: string | null;
  lensModel?: string | null;
  iso?: number | null;
  exposureTime?: string | null;
  focalLength?: number | null;
  fNumber?: number | null;
}> {
  try {
    let takenAt: Date | undefined;
    let lat: number | undefined;
    let lon: number | undefined;

    const exif = (await exifr.parse(path, { tiff: true, ifd0: true, exif: true, gps: true })) as
      | ExifData
      | undefined;

    // Take the first plausible candidate, so a "0000:00:00 00:00:00" original
    // date falls through to CreateDate / ModifyDate.
    for (const dateVal of [exif?.DateTimeOriginal, exif?.CreateDate, exif?.ModifyDate] as unknown[]) {
      const parsed =
        dateVal instanceof Date ? dateVal : typeof dateVal === 'string' ? new Date(dateVal) : null;
      if (parsed && isPlausibleDate(parsed)) {
        takenAt = parsed;
        break;
      }
    }

    if (typeof exif?.latitude === 'number' && typeof exif?.longitude === 'number') {
      lat = exif.latitude;
      lon = exif.longitude;
    }

    const cameraMake = safeString(exif?.Make);
    const cameraModel = safeString(exif?.Model);
    const lensModel = safeString(exif?.LensModel);
    const iso = typeof exif?.ISO === 'number' ? exif.ISO : null;
    const exposureTime = exif?.ExposureTime
      ? String(exif.ExposureTime)
      : exif?.ExposureTimeValue
        ? String(exif.ExposureTimeValue)
        : null;
    const focalLength =
      typeof exif?.FocalLengthIn35mmFormat === 'number'
        ? exif.FocalLengthIn35mmFormat
        : typeof exif?.FocalLength === 'number'
          ? exif.FocalLength
          : null;
    const fNumber = typeof exif?.FNumber === 'number' ? exif.FNumber : null;

    return {
      takenAt,
      lat,
      lon,
      cameraMake,
      cameraModel,
      lensModel,
      iso,
      exposureTime,
      focalLength,
      fNumber,
    };
  } catch (error) {
    logger.debug('EXIF parse failed', { path, error });
    return { lat: undefined, lon: undefined, takenAt: undefined };
  }
}
