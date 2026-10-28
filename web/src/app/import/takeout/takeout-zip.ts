import { BlobReader, BlobWriter, TextWriter, ZipReader, type FileEntry } from '@zip.js/zip.js';
import type { TakeoutEntry } from './takeout-plan';

// Reads Takeout zips in place. Only the central directory (the file list at
// the end of the zip) is read up front; an entry's bytes are read when its
// upload starts. Takeout zips are often 50 GB and zip64; zip.js reads them
// through File.slice, so nothing is loaded whole.

export interface OpenZip {
  file: File;
  reader: ZipReader<unknown>;
  entries: Map<string, FileEntry>;
}

export async function openZips(
  files: readonly File[],
  onProgress?: (done: number) => void,
): Promise<{ zips: OpenZip[]; entries: TakeoutEntry[] }> {
  const zips: OpenZip[] = [];
  const entries: TakeoutEntry[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const reader = new ZipReader(new BlobReader(file));
    const map = new Map<string, FileEntry>();
    for (const e of await reader.getEntries()) {
      if (e.directory || e.encrypted) continue;
      map.set(e.filename, e);
      entries.push({ zip: i, path: e.filename, size: e.uncompressedSize });
    }
    zips.push({ file, reader, entries: map });
    onProgress?.(i + 1);
  }
  return { zips, entries };
}

export async function closeZips(zips: readonly OpenZip[]): Promise<void> {
  await Promise.all(zips.map((z) => z.reader.close().catch(() => undefined)));
}

function entryOf(zips: readonly OpenZip[], e: TakeoutEntry): FileEntry {
  const entry = zips[e.zip]?.entries.get(e.path);
  if (!entry) throw new Error(`${e.path} is not in the zip`);
  return entry;
}

// The bytes of an entry as a Blob. A STORED entry (no compression) is a slice
// of the zip itself, so it costs no memory; its data starts after the local
// header (30 bytes, then the name and extra field, whose lengths are in the
// header). A compressed entry is inflated into a Blob (the browser keeps big
// Blobs on disk).
export async function entryBlob(zips: readonly OpenZip[], e: TakeoutEntry, type: string): Promise<Blob> {
  const entry = entryOf(zips, e);
  const file = zips[e.zip]!.file;
  if (entry.compressionMethod === 0 && entry.compressedSize === entry.uncompressedSize) {
    const head = new DataView(await file.slice(entry.offset, entry.offset + 30).arrayBuffer());
    if (head.getUint32(0, true) === 0x04034b50) {
      const start = entry.offset + 30 + head.getUint16(26, true) + head.getUint16(28, true);
      return file.slice(start, start + entry.uncompressedSize, type);
    }
  }
  return entry.getData(new BlobWriter(type));
}

export async function entryText(zips: readonly OpenZip[], e: TakeoutEntry): Promise<string> {
  return entryOf(zips, e).getData(new TextWriter());
}
