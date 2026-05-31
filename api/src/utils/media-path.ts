import * as fs from "node:fs";
import path from "node:path";

// A media file recorded in the DB may live at a different absolute path than
// where it's mounted in this process (e.g. host path vs container path). The
// MEDIA_PATH_MAP env (`from=to;from2=to2`) lets us translate. Shared by the
// asset/face streaming routes and the re-encode cleanup.

type MediaPathMap = { from: string; to: string };

function parseMediaPathMap(raw?: string): MediaPathMap[] {
  if (!raw) return [];
  return raw
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [from, to] = entry.split("=");
      if (!from || !to) return null;
      return { from: path.resolve(from), to: path.resolve(to) };
    })
    .filter((m): m is MediaPathMap => m !== null);
}

const mediaPathMap = parseMediaPathMap(process.env["MEDIA_PATH_MAP"]);

// Resolve an absolute media path to one that exists, applying MEDIA_PATH_MAP
// translations as a fallback. Returns the original resolved path if nothing
// matches (caller handles the missing file).
export async function resolveAssetPath(absPath: string): Promise<string> {
  const resolved = path.resolve(absPath);
  try {
    await fs.promises.access(resolved);
    return resolved;
  } catch {}

  for (const map of mediaPathMap) {
    if (resolved === map.from || resolved.startsWith(`${map.from}${path.sep}`)) {
      const rel = path.relative(map.from, resolved);
      const candidate = path.resolve(map.to, rel);
      try {
        await fs.promises.access(candidate);
        return candidate;
      } catch {}
    }
  }

  return resolved;
}
