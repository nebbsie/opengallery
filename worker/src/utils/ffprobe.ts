import { spawn } from 'node:child_process';

type FfprobeFormat = {
  duration?: string;
  tags?: Record<string, unknown>;
};

type FfprobeStream = {
  codec_type?: string;
  width?: number;
  height?: number;
  tags?: Record<string, unknown>;
};

type FfprobeResult = {
  format?: FfprobeFormat;
  streams?: FfprobeStream[];
};

function parseDate(value: unknown): Date | undefined {
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  return undefined;
}

function parseIso6709(value: string): { lat?: number; lon?: number } {
  const cleaned = value.trim().replace(/\/$/, '');
  const match = cleaned.match(/^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)(?:[+-]\d+(?:\.\d+)?)?$/);
  if (!match) return {};
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
  return {};
}

function extractLatLonFromTags(tags: Record<string, unknown> | undefined): {
  lat?: number;
  lon?: number;
} {
  if (!tags) return {};

  const iso = (tags['com.apple.quicktime.location.ISO6709'] || tags['location']) as unknown;
  if (typeof iso === 'string') {
    const r = parseIso6709(iso);
    if (r.lat != null && r.lon != null) return r;
  }

  const latRaw = tags['gps_latitude'] as unknown;
  const lonRaw = tags['gps_longitude'] as unknown;
  if (typeof latRaw === 'string' && typeof lonRaw === 'string') {
    const lat = Number(latRaw);
    const lon = Number(lonRaw);
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
  }

  return {};
}

function extractTakenAtFromTags(tags: Record<string, unknown> | undefined): Date | undefined {
  if (!tags) return undefined;
  return (
    parseDate(tags['creation_time']) ||
    parseDate(tags['com.apple.quicktime.creationdate']) ||
    parseDate(tags['date']) ||
    parseDate(tags['Creation Time']) ||
    undefined
  );
}

async function runFfprobeJson(path: string): Promise<FfprobeResult | undefined> {
  return new Promise((resolve) => {
    const args = ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', path];
    const child = spawn('ffprobe', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', (d) => (stdout += String(d)));
    child.on('close', () => {
      try {
        const json = JSON.parse(stdout) as FfprobeResult;
        resolve(json);
      } catch {
        resolve(undefined);
      }
    });
    child.on('error', () => resolve(undefined));
  });
}

export async function getVideoMetadata(inputPath: string): Promise<{
  width?: number;
  height?: number;
  duration?: number; // in seconds
  takenAt?: Date;
  lat?: number;
  lon?: number;
  cameraMake?: string;
  cameraModel?: string;
  lensModel?: string;
}> {
  const info = await runFfprobeJson(inputPath);
  if (!info) return {};

  const videoStream = (info.streams || []).find((s) => s.codec_type === 'video');
  const width = videoStream?.width;
  const height = videoStream?.height;

  // Get duration from format (in seconds)
  const duration = info.format?.duration ? Number(info.format.duration) : undefined;

  const formatTags = info.format?.tags;
  const streamTags = videoStream?.tags;

  const takenAt = extractTakenAtFromTags(streamTags) || extractTakenAtFromTags(formatTags);
  const cameraMake =
    (streamTags?.['make'] as string | undefined) ||
    (formatTags?.['make'] as string | undefined) ||
    (streamTags?.['com.apple.quicktime.make'] as string | undefined) ||
    (formatTags?.['com.apple.quicktime.make'] as string | undefined);
  const cameraModel =
    (streamTags?.['model'] as string | undefined) ||
    (formatTags?.['model'] as string | undefined) ||
    (streamTags?.['com.apple.quicktime.model'] as string | undefined) ||
    (formatTags?.['com.apple.quicktime.model'] as string | undefined);
  const lensModel =
    (streamTags?.['com.apple.quicktime.lens-model'] as string | undefined) ||
    (formatTags?.['com.apple.quicktime.lens-model'] as string | undefined) ||
    (streamTags?.['lens_model'] as string | undefined) ||
    (formatTags?.['lens_model'] as string | undefined);
  const { lat, lon } = extractLatLonFromTags(streamTags) || extractLatLonFromTags(formatTags);

  // With exactOptionalPropertyTypes enabled, avoid returning properties with value `undefined`.
  const result: {
    width?: number;
    height?: number;
    duration?: number;
    takenAt?: Date;
    lat?: number;
    lon?: number;
    cameraMake?: string;
    cameraModel?: string;
    lensModel?: string;
  } = {};
  if (width != null) result.width = width;
  if (height != null) result.height = height;
  if (duration != null && !isNaN(duration)) result.duration = duration;
  if (takenAt != null) result.takenAt = takenAt;
  if (lat != null) result.lat = lat;
  if (lon != null) result.lon = lon;
  if (cameraMake != null) result.cameraMake = cameraMake;
  if (cameraModel != null) result.cameraModel = cameraModel;
  if (lensModel != null) result.lensModel = lensModel;

  return result;
}
