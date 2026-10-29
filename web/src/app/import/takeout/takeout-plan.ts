// Plans a Google Takeout import from the file lists of its zips (no Angular,
// no zip reading here: see takeout-zip.ts). A Takeout export is split over
// several zips; one album's photos, and a photo's JSON sidecar, can be in
// different zips, so the plan works on the entries of all zips together.
//
// Layout: Takeout/<Google Photos, localized>/<folder>/<file>. A folder with a
// metadata.json is an album; "Photos from 2019" (localized: a name that ends
// in a year) is a year folder. Album photos also sit in their year folder, so
// album items come first and a year item with the same name and size as an
// album item is skipped (the server's content-hash check catches the rest).

export interface TakeoutEntry {
  // Index of the zip in the picked list.
  zip: number;
  // Full path inside the zip, "/" separated.
  path: string;
  size: number;
}

export interface TakeoutMeta {
  takenAt: string | null;
  lat: number | null;
  lon: number | null;
  description: string | null;
}

export type SkipReason = 'unsupported' | 'trash' | 'in-album' | 'in-other-album' | 'empty';

export const SKIP_LABELS: Record<SkipReason, string> = {
  unsupported: 'Not a photo or video',
  trash: 'In the Google Photos trash',
  'in-album': 'Already in an album folder',
  'in-other-album': 'Also in another album',
  empty: 'Empty files',
};

export interface PlanItem {
  entry: TakeoutEntry;
  name: string;
  type: 'image' | 'video';
  // Folder name in the Takeout, and the folder it goes to under "Google Photos".
  source: string;
  target: string;
  kind: 'album' | 'year';
  // The JSON sidecar, read when the upload starts.
  json: TakeoutEntry | null;
}

export interface TakeoutPlan {
  items: PlanItem[];
  albums: { name: string; count: number }[];
  years: { name: string; count: number }[];
  withJson: number;
  // Live Photo videos imported next to their still; the server pairs them.
  livePhotos: number;
  skipped: { reason: SkipReason; count: number }[];
  totalBytes: number;
}

// The folder Google puts photos in, in the export languages seen so far.
// Anything else under Takeout/ (Drive, Mail, ...) is ignored.
const PHOTOS_ROOTS = new Set([
  'google photos',
  'google fotos',
  'google foto',
  'google photos (1)',
  'google 相簿',
  'google フォト',
  'google 포토',
  'google zdjęcia',
  'zdjęcia google',
]);

const TRASH_FOLDERS = new Set(['trash', 'bin', 'papierkorb', 'corbeille', 'papelera', 'cestino', 'prullenbak', 'kosz']);

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tiff', 'tif', 'heic', 'heif']);
const RAW_EXT = new Set(['rw2', 'nef', 'cr2', 'cr3', 'arw', 'dng', 'raf', 'orf', 'pef', 'srw']);
// A Live Photo: a still and a short video with the same name in a folder. The
// server pairs them (api/src/utils/raw-pairing.ts, same limit).
const LIVE_STILL_EXT = new Set(['heic', 'heif', 'jpg', 'jpeg']);
const LIVE_VIDEO_EXT = new Set(['mov', 'mp4']);
const LIVE_MAX_BYTES = 20 * 1024 * 1024;
const VIDEO_EXT = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'flv', 'm4v', '3gp', 'mts', 'm2ts']);

// "-edited" copies share the JSON of the original (localized suffixes too).
const EDITED_SUFFIXES = ['-edited', '-bearbeitet', '-modifié', '-editado', '-modificato', '-bewerkt', '-redigerad'];

const YEAR_FOLDER = /^\D*?(19|20)\d{2}$/;

export function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function split(path: string): { root: string; folder: string; name: string } | null {
  // Takeout/<root>/<folder>/<name>; deeper paths keep the first folder.
  const parts = path.split('/').filter(Boolean);
  const t = parts.findIndex((p) => p.toLowerCase() === 'takeout');
  if (t < 0 || parts.length < t + 4) return null;
  return { root: parts[t + 1]!, folder: parts[t + 2]!, name: parts[parts.length - 1]! };
}

export function isPhotosRoot(name: string): boolean {
  const n = name.toLowerCase();
  return PHOTOS_ROOTS.has(n) || (n.startsWith('google') && /phot|fot|foto/.test(n));
}

function folderYear(folder: string): string | null {
  const m = folder.trim().match(YEAR_FOLDER);
  return m ? folder.trim().slice(-4) : null;
}

// "IMG_1(1).jpg" -> { base: "IMG_1.jpg", dup: "(1)" }.
function splitDup(name: string): { base: string; dup: string } {
  const m = name.match(/^(.*)(\(\d+\))(\.[^.]+)$/);
  return m ? { base: m[1]! + m[3]!, dup: m[2]! } : { base: name, dup: '' };
}

function stripEdited(name: string): string | null {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (const s of EDITED_SUFFIXES) {
    if (stem.toLowerCase().endsWith(s)) return stem.slice(0, stem.length - s.length) + ext;
  }
  return null;
}

// JSON sidecars of one folder: basename without ".json" -> entry.
type JsonIndex = Map<string, TakeoutEntry>;

const SUPPLEMENTAL = '.supplemental-metadata';
// Google cuts the JSON file name to about 51 characters ("…supplemental-me.json").
const MIN_TRUNCATED_KEY = 40;

// The JSON sidecar of `name` in a folder, or null. Order: exact names, then
// Google's truncated names, then the name without the extension (old exports).
export function findSidecar(name: string, jsons: JsonIndex): TakeoutEntry | null {
  const { base, dup } = splitDup(name);
  const full = base + SUPPLEMENTAL;
  const exact = [full + dup, base + dup, base + SUPPLEMENTAL + dup];
  if (dup) exact.push(base.replace(/(\.[^.]+)$/, `${dup}$1`) + SUPPLEMENTAL, name + SUPPLEMENTAL, name);
  for (const k of exact) {
    const hit = jsons.get(k);
    if (hit) return hit;
  }
  // Truncated: a key that is a prefix of the full name and long enough not to
  // match some other file. The duplicate counter stays at the end.
  let best: { key: string; entry: TakeoutEntry } | null = null;
  for (const [key, entry] of jsons) {
    let k = key;
    if (dup) {
      if (!k.endsWith(dup)) continue;
      k = k.slice(0, -dup.length);
    } else if (/\(\d+\)$/.test(k)) {
      continue;
    }
    if (!full.startsWith(k)) continue;
    if (k.length < Math.min(base.length, MIN_TRUNCATED_KEY)) continue;
    if (!best || k.length > best.key.length) best = { key: k, entry };
  }
  if (best) return best.entry;
  const stem = base.slice(0, base.length - (extOf(base).length + 1));
  return jsons.get(stem + dup) ?? jsons.get(stem) ?? null;
}

function sidecarFor(name: string, jsons: JsonIndex, photosInFolder: Set<string>): TakeoutEntry | null {
  const direct = findSidecar(name, jsons);
  if (direct) return direct;
  const original = stripEdited(name);
  if (original) {
    const hit = findSidecar(original, jsons);
    if (hit) return hit;
  }
  // A Live Photo's video uses its photo's JSON.
  if (VIDEO_EXT.has(extOf(name))) {
    const stem = name.slice(0, name.lastIndexOf('.')).toLowerCase();
    for (const p of photosInFolder) {
      if (p.slice(0, p.lastIndexOf('.')).toLowerCase() === stem) {
        const hit = findSidecar(p, jsons);
        if (hit) return hit;
      }
    }
  }
  return null;
}

export function buildPlan(entries: readonly TakeoutEntry[]): TakeoutPlan {
  type Folder = { name: string; album: boolean; media: TakeoutEntry[]; jsons: JsonIndex; names: Set<string> };
  const folders = new Map<string, Folder>();
  const skipped = new Map<SkipReason, number>();
  const skip = (r: SkipReason) => skipped.set(r, (skipped.get(r) ?? 0) + 1);

  for (const e of entries) {
    if (e.path.endsWith('/')) continue;
    const p = split(e.path);
    if (!p || !isPhotosRoot(p.root)) continue;
    const key = `${p.root}/${p.folder}`;
    let f = folders.get(key);
    if (!f) {
      f = { name: p.folder, album: false, media: [], jsons: new Map(), names: new Set() };
      folders.set(key, f);
    }
    if (p.name.startsWith('.')) continue;
    const ext = extOf(p.name);
    if (ext === 'json') {
      if (p.name === 'metadata.json' || p.name.startsWith('metadata(')) f.album = true;
      else f.jsons.set(p.name.slice(0, -5), e);
      continue;
    }
    if (ext === 'html' || ext === 'txt' || ext === 'csv') continue;
    f.media.push(e);
    f.names.add(p.name);
  }

  const items: PlanItem[] = [];
  const albumKeys = new Set<string>();
  const albums = new Map<string, number>();
  const years = new Map<string, number>();
  let withJson = 0;
  let livePhotos = 0;
  let totalBytes = 0;

  // Albums first (sorted by name), then year folders oldest first.
  const ordered = [...folders.values()]
    .filter((f) => {
      if (TRASH_FOLDERS.has(f.name.toLowerCase())) {
        for (let i = 0; i < f.media.length; i++) skip('trash');
        return false;
      }
      return true;
    })
    .map((f) => {
      const year = f.album ? null : folderYear(f.name);
      return { f, year, isAlbum: !year };
    })
    .sort((a, b) =>
      a.isAlbum !== b.isAlbum ? (a.isAlbum ? -1 : 1) : (a.year ?? a.f.name).localeCompare(b.year ?? b.f.name),
    );

  for (const { f, year, isAlbum } of ordered) {
    const photoNames = new Set([...f.names].filter((n) => !VIDEO_EXT.has(extOf(n))));
    const liveStills = new Set(
      [...photoNames].filter((n) => LIVE_STILL_EXT.has(extOf(n))).map((n) => n.slice(0, n.lastIndexOf('.')).toLowerCase()),
    );
    for (const e of f.media) {
      const name = e.path.slice(e.path.lastIndexOf('/') + 1);
      const ext = extOf(name);
      const type: 'image' | 'video' | null =
        IMAGE_EXT.has(ext) || RAW_EXT.has(ext) ? 'image' : VIDEO_EXT.has(ext) ? 'video' : null;
      if (!type) {
        skip('unsupported');
        continue;
      }
      if (e.size === 0) {
        skip('empty');
        continue;
      }
      const same = `${name.toLowerCase()}|${e.size}`;
      if (albumKeys.has(same)) {
        skip(isAlbum ? 'in-other-album' : 'in-album');
        continue;
      }
      // A Live Photo's short video goes into the same folder as its still, so
      // the server pairs them and shows one photo.
      if (
        type === 'video' &&
        LIVE_VIDEO_EXT.has(ext) &&
        e.size <= LIVE_MAX_BYTES &&
        liveStills.has(name.slice(0, name.lastIndexOf('.')).toLowerCase())
      ) {
        livePhotos++;
      }
      if (isAlbum) albumKeys.add(same);
      const json = sidecarFor(name, f.jsons, photoNames);
      if (json) withJson++;
      const target = isAlbum ? f.name.trim() || 'Untitled album' : year!;
      items.push({ entry: e, name, type, source: f.name, target, kind: isAlbum ? 'album' : 'year', json });
      (isAlbum ? albums : years).set(target, ((isAlbum ? albums : years).get(target) ?? 0) + 1);
      totalBytes += e.size;
    }
  }

  return {
    items,
    albums: [...albums].map(([name, count]) => ({ name, count })),
    years: [...years].map(([name, count]) => ({ name, count })),
    withJson,
    livePhotos,
    skipped: [...skipped].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    totalBytes,
  };
}

// Reads a Takeout JSON sidecar. Times are UTC seconds; 0,0 means no position.
export function parseSidecar(text: string): TakeoutMeta {
  const out: TakeoutMeta = { takenAt: null, lat: null, lon: null, description: null };
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return out;
  }
  const ts = (j['photoTakenTime'] as { timestamp?: string | number } | undefined)?.timestamp;
  const secs = typeof ts === 'string' ? Number(ts) : ts;
  if (typeof secs === 'number' && Number.isFinite(secs) && secs > 0) {
    out.takenAt = new Date(secs * 1000).toISOString();
  }
  for (const k of ['geoData', 'geoDataExif']) {
    const g = j[k] as { latitude?: number; longitude?: number } | undefined;
    if (
      g &&
      typeof g.latitude === 'number' &&
      typeof g.longitude === 'number' &&
      !(g.latitude === 0 && g.longitude === 0) &&
      Math.abs(g.latitude) <= 90 &&
      Math.abs(g.longitude) <= 180
    ) {
      out.lat = g.latitude;
      out.lon = g.longitude;
      break;
    }
  }
  const d = j['description'];
  if (typeof d === 'string' && d.trim()) out.description = d.trim().slice(0, 5000);
  return out;
}
