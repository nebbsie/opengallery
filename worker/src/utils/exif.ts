import exifr from 'exifr';

export async function getExifInfo(
  path: string,
): Promise<{ takenAt: Date | undefined; lat: number | undefined; lon: number | undefined }> {
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

    return { takenAt, lat, lon };
  } catch {
    return { lat: undefined, lon: undefined, takenAt: undefined };
  }
}
