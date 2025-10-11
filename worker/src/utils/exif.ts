import exifr from 'exifr';

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

    const exif = await exifr.parse(path, { tiff: true, ifd0: true, exif: true, gps: true });
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

    const cameraMake = (exif as any)?.Make ?? null;
    const cameraModel = (exif as any)?.Model ?? null;
    const lensModel = (exif as any)?.LensModel ?? null;
    const iso = typeof (exif as any)?.ISO === 'number' ? ((exif as any)?.ISO as number) : null;
    const exposureTime = (exif as any)?.ExposureTime
      ? String((exif as any)?.ExposureTime)
      : (exif as any)?.ExposureTimeValue
        ? String((exif as any)?.ExposureTimeValue)
        : null;
    const focalLength =
      typeof (exif as any)?.FocalLengthIn35mmFormat === 'number'
        ? ((exif as any)?.FocalLengthIn35mmFormat as number)
        : typeof (exif as any)?.FocalLength === 'number'
          ? ((exif as any)?.FocalLength as number)
          : null;
    const fNumber =
      typeof (exif as any)?.FNumber === 'number' ? ((exif as any)?.FNumber as number) : null;

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
  } catch {
    return { lat: undefined, lon: undefined, takenAt: undefined };
  }
}
