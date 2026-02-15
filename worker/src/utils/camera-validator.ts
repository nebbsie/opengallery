function isGarbled(str: string | null): boolean {
  if (!str || str.length === 0) return false;
  if (str.length > 100) return true;

  const printableCount = str.replace(/[^\x20-\x7E]/g, '').length;
  if (printableCount / str.length < 0.7) return true;

  return false;
}

const KNOWN_MAKES = new Set([
  'apple', 'canon', 'casio', 'fuji', 'fujifilm', 'gopro', 'hasselblad',
  'hikvision', 'honor', 'huawei', 'kodak', 'leica', 'lenovo', 'lg',
  'mamiya', 'marantz', 'motorola', 'nikon', 'nokia', 'olympus', 'panasonic',
  'pentax', 'phase one', 'ricoh', 'samsung', 'sony', 'toshiba', 'vivo',
  'xiaomi', 'zoran', 'zte', 'google', 'oneplus', 'oppo', 'realme', 'sharp',
  'jvc', 'sanyo', 'polaroid', 'minolta', 'konica', 'kyocera', 'benq', 'epson', 'hp'
]);

function normalizeMake(make: string | null): string | null {
  if (!make) return null;
  const normalized = make.toLowerCase().trim();
  for (const known of KNOWN_MAKES) {
    if (normalized.includes(known) || known.includes(normalized)) {
      return known;
    }
  }
  return null;
}

export interface CameraValidationResult {
  isValid: boolean;
  cameraMake: string | null;
  cameraModel: string | null;
}

export function validateCamera(
  cameraMake: string | null,
  cameraModel: string | null,
): CameraValidationResult {
  if (!cameraMake && !cameraModel) {
    return { isValid: false, cameraMake: null, cameraModel: null };
  }

  if (isGarbled(cameraMake) || isGarbled(cameraModel)) {
    return { isValid: false, cameraMake: null, cameraModel: null };
  }

  const normalizedMake = normalizeMake(cameraMake);
  if (!normalizedMake) {
    return { isValid: false, cameraMake: null, cameraModel: null };
  }

  return {
    isValid: true,
    cameraMake: normalizedMake,
    cameraModel: cameraModel?.trim() || null,
  };
}
