import exifr from 'exifr';
import type { ExifData } from '../types/exif-data.js';
import { logger } from './logger.js';
import { isRawName } from './media-types.js';
import { readRawTags, type RawTags } from './raw.js';

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

export type ExifInfo = {
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
  // Camera RAW only: the full sensor size, upright.
  width?: number | null;
  height?: number | null;
};

// "2021:02:13 13:44:40" -> a Date in local time, the same way exifr builds
// EXIF dates, so a RAW and its JPEG get the same takenAt.
function parseExifDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number) as [number, number, number, number, number, number, number];
  return new Date(y, mo - 1, d, h, mi, s);
}

function rawExifInfo(tags: RawTags): ExifInfo {
  let takenAt: Date | undefined;
  for (const value of [tags.DateTimeOriginal, tags.CreateDate, tags.ModifyDate]) {
    const parsed = parseExifDate(value);
    if (parsed && isPlausibleDate(parsed)) {
      takenAt = parsed;
      break;
    }
  }
  const lat = typeof tags.GPSLatitude === 'number' ? tags.GPSLatitude : undefined;
  const lon = typeof tags.GPSLongitude === 'number' ? tags.GPSLongitude : undefined;
  // 0,0 is what a camera without a GPS fix writes.
  const hasGps = lat !== undefined && lon !== undefined && !(lat === 0 && lon === 0);
  const [w, h] = (tags.ImageSize ?? '').split(/[ x]/).map(Number);
  const swap = (tags.Orientation ?? 1) >= 5;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    takenAt,
    lat: hasGps ? lat : undefined,
    lon: hasGps ? lon : undefined,
    cameraMake: safeString(tags.Make),
    cameraModel: safeString(tags.Model),
    lensModel: safeString(tags.LensModel),
    iso: num(tags.ISO),
    exposureTime: num(tags.ExposureTime) !== null ? String(tags.ExposureTime) : null,
    focalLength: num(tags.FocalLengthIn35mmFormat) ?? num(tags.FocalLength),
    fNumber: num(tags.FNumber),
    width: w && h ? (swap ? h : w) : null,
    height: w && h ? (swap ? w : h) : null,
  };
}

export async function getExifInfo(path: string): Promise<ExifInfo> {
  if (isRawName(path)) {
    // exifr cannot read most RAW formats (RW2, CR3); exiftool reads them all.
    // A read error is thrown, not swallowed: the callers (encode, GPS) retry
    // instead of saving the photo without its date or place.
    return rawExifInfo(await readRawTags(path));
  }
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
