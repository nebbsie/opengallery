import exifr from 'exifr';
import { logger } from './logger.js';
import type { ExifData } from '../types/exif-data.js';

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

    const exif = await exifr.parse(path, { tiff: true, ifd0: true, exif: true, gps: true }) as ExifData | undefined;

    const dateVal: unknown = exif?.DateTimeOriginal || exif?.CreateDate || exif?.ModifyDate;

    if (dateVal instanceof Date) {
      takenAt = dateVal;
    } else if (typeof dateVal === 'string') {
      const parsed = new Date(dateVal);
      if (!isNaN(parsed.getTime())) {
        takenAt = parsed;
      }
    }

    if (typeof exif?.latitude === 'number' && typeof exif?.longitude === 'number') {
      lat = exif.latitude;
      lon = exif.longitude;
    }

    const cameraMake = exif?.Make ?? null;
    const cameraModel = exif?.Model ?? null;
    const lensModel = exif?.LensModel ?? null;
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
    const fNumber =
      typeof exif?.FNumber === 'number' ? exif.FNumber : null;

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
