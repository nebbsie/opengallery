import { spawn } from 'node:child_process';

type FfprobeFormat = {
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

export async function getVideoMetadata(
  inputPath: string,
): Promise<{ width?: number; height?: number; takenAt?: Date; lat?: number; lon?: number }> {
  const info = await runFfprobeJson(inputPath);
  if (!info) return {};

  const videoStream = (info.streams || []).find((s) => s.codec_type === 'video');
  const width = videoStream?.width;
  const height = videoStream?.height;

  const formatTags = info.format?.tags;
  const streamTags = videoStream?.tags;

  const takenAt = extractTakenAtFromTags(streamTags) || extractTakenAtFromTags(formatTags);
  const { lat, lon } = extractLatLonFromTags(streamTags) || extractLatLonFromTags(formatTags);

  return { width, height, takenAt, lat, lon };
}
