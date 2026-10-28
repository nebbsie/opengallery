import type { RouterOutputs } from '@core/services/trpc';

type ViewFile = RouterOutputs['files']['viewFile'];

// The date to show for an item: when it was taken, or when it was imported.
export function assetDate(data: ViewFile | null | undefined): Date | null {
  if (!data) return null;
  const raw = data.imageMetadata?.takenAt ?? data.file.createdAt;
  if (!raw) return null;
  const d = new Date(raw as unknown as string);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatCoords(geo: { lat: number | string; lon: number | string } | null): string {
  if (!geo) return '';
  const lat = Number(geo.lat);
  const lon = Number(geo.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}° ${ns}, ${Math.abs(lon).toFixed(4)}° ${ew}`;
}

export function formatBytes(bytes: number | null | undefined): string {
  const size = typeof bytes === 'number' && isFinite(bytes) && bytes >= 0 ? bytes : 0;
  if (size === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
  const value = size / Math.pow(1024, i);
  return `${value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[i]}`;
}

export function getMegapixels(width: number | null | undefined, height: number | null | undefined): string {
  if (!width || !height) return '';
  const megapixels = (width * height) / 1_000_000;
  if (megapixels < 1) return `${(megapixels * 1000).toFixed(0)}K`;
  return `${megapixels.toFixed(1)} MP`;
}

export function formatShutterSpeed(value: string | number): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!isFinite(n) || n <= 0) return String(value);
  if (n >= 1) return `${Number(n >= 10 ? n.toFixed(0) : n.toFixed(1))}s`;
  return `1/${Math.round(1 / n)}`;
}

function videoResolutionLabel(height: number | null | undefined): string {
  if (!height) return '';
  if (height < 540) return '480p';
  if (height < 800) return '720p';
  if (height < 1300) return '1080p';
  if (height < 1900) return '1440p';
  if (height < 2600) return '2160p';
  if (height < 4400) return '4320p';
  if (height < 9000) return '8640p';
  return `${height}p`;
}

function videoTierLabel(height: number | null | undefined): string {
  if (!height) return '';
  if (height < 720) return 'SD';
  if (height < 1080) return 'HD';
  if (height < 1440) return 'FHD';
  if (height < 2160) return 'QHD';
  if (height < 4320) return '4K';
  if (height < 8640) return '8K';
  return 'Ultra';
}

export function getVideoBadgeLabel(height: number | null | undefined): string {
  const res = videoResolutionLabel(height);
  const tier = videoTierLabel(height);
  if (!res || !tier) return res || tier;
  return `${res} · ${tier}`;
}

export function getBadgeClass(height: number | null | undefined): string {
  switch (videoTierLabel(height)) {
    case 'SD':
      return 'bg-secondary text-secondary-foreground font-bold';
    case 'HD':
      return 'bg-blue-600 text-white font-bold';
    case 'FHD':
      return 'bg-indigo-600 text-white font-bold';
    case 'QHD':
      return 'bg-purple-600 text-white font-bold';
    case '4K':
      return 'bg-emerald-600 text-white font-bold';
    case '8K':
      return 'bg-rose-600 text-white font-bold';
    default:
      return 'bg-primary text-primary-foreground font-bold';
  }
}
