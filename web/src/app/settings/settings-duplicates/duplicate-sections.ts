// Groups duplicate files by the set of folders their copies are in, so a whole
// folder pair (e.g. 114 photos copied from "Photo Sesh" into "Random Photos")
// can be cleaned with one action. Plain functions: no Angular, easy to test.

export type DupeFile = {
  id: string;
  dir: string;
  name: string;
  size: number;
  type: string;
  contentHash: string | null;
  takenAt: string | null;
  createdAt: string;
  width?: number | null;
  height?: number | null;
  // RAW companion of a RAW+JPEG pair; kept on disk, shown as its own photo.
  rawName?: string | null;
};

export type DupeGroup = { contentHash: string; files: DupeFile[] };

export type Folder = {
  dir: string;
  // The folder path below the section's shared parent, e.g. "Random Photos".
  label: string;
};

export type DupeSection = {
  key: string;
  folders: Folder[];
  // Shared parent of all folders, for the header (null when none).
  base: string | null;
  groups: DupeGroup[];
  // Bytes freed when only one copy of each group stays.
  freeable: number;
  copies: number;
};

export type DeletePlan = {
  // Files to move to the trash.
  remove: DupeFile[];
  // Files that stay, one or more per group.
  keep: DupeFile[];
  groups: number;
  bytes: number;
};

const sortDirs = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

function commonParent(dirs: string[]): string | null {
  const parts = dirs.map((d) => d.split('/'));
  const first = parts[0] ?? [];
  let n = 0;
  while (n < first.length && parts.every((p) => p[n] === first[n])) n++;
  let common = first.slice(0, n).join('/');
  // "a/b" and "a/b/c": the shared folder is itself a section folder, so labels
  // start one level up ("b" and "b/c", not "" and "c").
  if (dirs.includes(common)) common = common.slice(0, common.lastIndexOf('/'));
  return common || null;
}

function folderLabel(dir: string, base: string | null): string {
  if (base && dir.startsWith(base + '/')) return dir.slice(base.length + 1);
  return dir.split('/').filter(Boolean).slice(-2).join('/') || dir;
}

export function buildSections(groups: DupeGroup[]): DupeSection[] {
  const byKey = new Map<string, DupeSection>();
  for (const g of groups) {
    if (g.files.length < 2) continue;
    const dirs = [...new Set(g.files.map((f) => f.dir))].sort(sortDirs);
    const key = dirs.join('\n');
    let s = byKey.get(key);
    if (!s) {
      const base = dirs.length > 1 ? commonParent(dirs) : null;
      s = {
        key,
        folders: dirs.map((dir) => ({
          dir,
          label: dirs.length > 1 ? folderLabel(dir, base) : folderLabel(dir, null),
        })),
        base,
        groups: [],
        freeable: 0,
        copies: 0,
      };
      byKey.set(key, s);
    }
    s.groups.push(g);
    s.freeable += g.files[0]!.size * (g.files.length - 1);
    s.copies += g.files.length;
  }
  return [...byKey.values()].sort(
    (a, b) => b.groups.length - a.groups.length || b.freeable - a.freeable,
  );
}

// The copy to keep when no folder is preferred: added first, then the
// shorter name (originals are usually "IMG_1.jpg", copies "IMG_1 (2).jpg").
export function oldestCopy(files: DupeFile[]): DupeFile {
  return [...files].sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) ||
      a.name.length - b.name.length ||
      a.name.localeCompare(b.name),
  )[0]!;
}

function plan(groups: DupeGroup[], pick: (g: DupeGroup) => DupeFile): DeletePlan {
  const remove: DupeFile[] = [];
  const keep: DupeFile[] = [];
  let bytes = 0;
  for (const g of groups) {
    const kept = pick(g);
    keep.push(kept);
    for (const f of g.files) {
      if (f.id === kept.id) continue;
      remove.push(f);
      bytes += f.size;
    }
  }
  return { remove, keep, groups: groups.length, bytes };
}

// Keep one copy in `dir` (the oldest there) and remove every other copy. A
// group with no copy in `dir` is left alone.
export function planKeepIn(groups: DupeGroup[], dir: string): DeletePlan {
  return plan(
    groups.filter((g) => g.files.some((f) => f.dir === dir)),
    (g) => oldestCopy(g.files.filter((f) => f.dir === dir)),
  );
}

// Keep the oldest copy of each group, wherever it is.
export function planKeepOldest(groups: DupeGroup[]): DeletePlan {
  return plan(groups, (g) => oldestCopy(g.files));
}

// Keep exactly this file of its group.
export function planKeepFile(group: DupeGroup, keep: DupeFile): DeletePlan {
  return plan([group], () => keep);
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / Math.pow(1024, i);
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}
