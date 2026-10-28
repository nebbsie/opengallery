import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import { crc32 } from "node:zlib";
import type { Writable } from "node:stream";

// Short-lived download tickets for "Download N items" in the web grid. The web
// asks for a ticket with a tRPC mutation (the id list can be long, too long for
// a URL), then opens GET /download/:token so the browser streams the zip
// straight to disk. Tickets are single-user, in memory and expire quickly.

const TICKET_TTL_MS = 10 * 60 * 1000;
const MAX_TICKETS = 200;

type Ticket = { userId: string; fileIds: string[]; expiresAt: number };
const tickets = new Map<string, Ticket>();

function prune(): void {
  const now = Date.now();
  for (const [k, t] of tickets) if (t.expiresAt < now) tickets.delete(k);
  while (tickets.size > MAX_TICKETS) {
    const first = tickets.keys().next().value;
    if (first === undefined) break;
    tickets.delete(first);
  }
}

export function createDownloadTicket(userId: string, fileIds: string[]): string {
  prune();
  const token = randomBytes(24).toString("base64url");
  tickets.set(token, { userId, fileIds, expiresAt: Date.now() + TICKET_TTL_MS });
  return token;
}

export function takeDownloadTicket(token: string, userId: string): string[] | null {
  prune();
  const t = tickets.get(token);
  if (!t || t.userId !== userId) return null;
  tickets.delete(token);
  return t.fileIds;
}

// ---------------------------------------------------------------------------
// Minimal streaming ZIP writer (STORE, no compression). Photos and videos are
// already compressed, so deflate would only burn CPU. Sizes and CRC go in a
// data descriptor after each entry, so nothing is read twice. No ZIP64: the
// caller keeps the archive under 4 GiB and 65535 entries.
// ---------------------------------------------------------------------------

export const ZIP_MAX_BYTES = 0xffffffff - 64 * 1024 * 1024;
export const ZIP_MAX_ENTRIES = 0xffff;

export type ZipEntry = { name: string; path: string; size: number; mtime: Date };

function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

function write(out: Writable, buf: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    if (out.destroyed) return reject(new Error("stream closed"));
    if (out.write(buf)) return resolve();
    const onDrain = () => {
      out.off("close", onClose);
      resolve();
    };
    const onClose = () => {
      out.off("drain", onDrain);
      reject(new Error("stream closed"));
    };
    out.once("drain", onDrain);
    out.once("close", onClose);
  });
}

/** Names inside one archive must be unique: "a.jpg", "a (2).jpg", ... */
export function uniqueZipNames(names: string[]): string[] {
  // Every produced name goes into `used`, so "IMG.jpg", "IMG.jpg",
  // "IMG (2).jpg" cannot give two "IMG (2).jpg" entries.
  const used = new Set<string>();
  return names.map((raw) => {
    const name = raw.replace(/[\\/]/g, "_") || "file";
    const dot = name.lastIndexOf(".");
    let candidate = name;
    for (let n = 2; used.has(candidate.toLowerCase()); n++) {
      candidate = dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

export async function writeZip(out: Writable, entries: ZipEntry[]): Promise<void> {
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const { time, date } = dosDateTime(entry.mtime);
    // Bit 3: sizes/CRC in the data descriptor. Bit 11: UTF-8 names.
    const flags = 0x0008 | 0x0800;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(0, 8); // STORE
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(0, 18);
    local.writeUInt32LE(0, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    await write(out, local);
    await write(out, nameBuf);

    let crc = 0;
    let size = 0;
    const stream = fs.createReadStream(entry.path, { highWaterMark: 256 * 1024 });
    try {
      for await (const chunk of stream) {
        const buf = chunk as Buffer;
        crc = crc32(buf, crc);
        size += buf.length;
        await write(out, buf);
      }
    } finally {
      stream.destroy();
    }

    const desc = Buffer.alloc(16);
    desc.writeUInt32LE(0x08074b50, 0);
    desc.writeUInt32LE(crc >>> 0, 4);
    desc.writeUInt32LE(size, 8);
    desc.writeUInt32LE(size, 12);
    await write(out, desc);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(flags, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc >>> 0, 16);
    cd.writeUInt32LE(size, 20);
    cd.writeUInt32LE(size, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += 30 + nameBuf.length + size + 16;
  }

  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  await write(out, cdBuf);
  await write(out, end);
}
