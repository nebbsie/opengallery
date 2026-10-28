// Detect an upload's real media type from its first bytes. The extension and
// the browser's mime type are only hints: a file is accepted when its magic
// bytes match a format the worker can import (worker/src/utils/media-types.ts).

export type SniffedMedia = {
  type: "image" | "video";
  // Extension the file is saved with when its own one does not fit.
  ext: string;
  mime: string;
  // Extensions that may stay as they are for this format.
  exts: readonly string[];
};

export type SniffResult =
  | { ok: true; media: SniffedMedia }
  | { ok: false; reason: string };

// Bytes needed for every check below.
export const SNIFF_BYTES = 64;

const RAW_EXTS = new Set([
  "dng", "nef", "nrw", "arw", "srf", "sr2", "cr2", "cr3", "crw", "orf",
  "rw2", "raf", "srw", "pef", "x3f", "3fr", "erf", "kdc", "mrw",
]);

const ascii = (b: Buffer, start: number, end: number) =>
  b.subarray(start, end).toString("latin1");

const startsWith = (b: Buffer, bytes: number[], at = 0) =>
  b.length >= at + bytes.length && bytes.every((v, i) => b[at + i] === v);

function media(
  type: "image" | "video",
  ext: string,
  mime: string,
  exts: readonly string[] = [ext],
): SniffResult {
  return { ok: true, media: { type, ext, mime, exts } };
}

export function sniffMedia(head: Buffer, fileName: string): SniffResult {
  const dot = fileName.lastIndexOf(".");
  const nameExt = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : "";

  if (startsWith(head, [0xff, 0xd8, 0xff])) {
    return media("image", "jpg", "image/jpeg", ["jpg", "jpeg"]);
  }
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return media("image", "png", "image/png");
  }
  if (ascii(head, 0, 6) === "GIF87a" || ascii(head, 0, 6) === "GIF89a") {
    return media("image", "gif", "image/gif");
  }
  if (ascii(head, 0, 4) === "RIFF" && head.length >= 12) {
    const kind = ascii(head, 8, 12);
    if (kind === "WEBP") return media("image", "webp", "image/webp");
    if (kind === "AVI ") return media("video", "avi", "video/x-msvideo");
  }
  if (
    startsWith(head, [0x49, 0x49, 0x2a, 0x00]) ||
    startsWith(head, [0x4d, 0x4d, 0x00, 0x2a])
  ) {
    // Most camera RAW formats are TIFF inside. The encoder cannot read them.
    if (RAW_EXTS.has(nameExt) || ascii(head, 8, 10) === "CR") {
      return { ok: false, reason: "RAW photos are not supported yet" };
    }
    return media("image", "tiff", "image/tiff");
  }
  if (ascii(head, 0, 2) === "BM" && head.length >= 18) {
    const dib = head.readUInt32LE(14);
    if ([12, 40, 52, 56, 64, 108, 124].includes(dib)) {
      return media("image", "bmp", "image/bmp");
    }
  }
  if (head.length >= 12 && ascii(head, 4, 8) === "ftyp") {
    const brand = ascii(head, 8, 12);
    if (["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(brand)) {
      return { ok: false, reason: "HEIC photos are not supported yet. Upload a JPEG" };
    }
    if (brand === "avif" || brand === "avis") {
      return { ok: false, reason: "AVIF images are not supported yet" };
    }
    if (brand === "crx ") {
      return { ok: false, reason: "RAW photos are not supported yet" };
    }
    if (brand === "qt  ") {
      return media("video", "mov", "video/quicktime", ["mov", "mp4"]);
    }
    return media("video", "mp4", "video/mp4", ["mp4", "mov"]);
  }
  if (startsWith(head, [0x1a, 0x45, 0xdf, 0xa3])) {
    return ascii(head, 0, head.length).includes("webm")
      ? media("video", "webm", "video/webm", ["webm", "mkv"])
      : media("video", "mkv", "video/x-matroska");
  }
  if (
    startsWith(head, [
      0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11,
      0xa6, 0xd9, 0x00, 0xaa, 0x00, 0x62, 0xce, 0x6c,
    ])
  ) {
    return media("video", "wmv", "video/x-ms-wmv");
  }
  if (ascii(head, 0, 3) === "FLV" && head[3] === 0x01) {
    return media("video", "flv", "video/x-flv");
  }

  return { ok: false, reason: "Not a photo or video" };
}

// File name to save: the stem the user gave plus an extension that matches the
// real format (so the scanner, which goes by extension, imports it).
export function finalFileName(cleanName: string, m: SniffedMedia): string {
  const dot = cleanName.lastIndexOf(".");
  const stem = dot > 0 ? cleanName.slice(0, dot) : cleanName;
  const ext = dot > 0 ? cleanName.slice(dot + 1) : "";
  if (m.exts.includes(ext.toLowerCase())) return cleanName;
  return `${stem || "upload"}.${m.ext}`;
}
