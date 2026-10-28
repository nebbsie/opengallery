import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { z } from 'zod';
import {
  type SessionLike,
  buildFileAccessFilter,
  getAccessScope,
} from '../authz/shared-access.js';
import { db } from '../db/index.js';
import { FileTable, ImageMetadataTable } from '../db/schema.js';
import { adminProcedure, router } from '../trpc.js';
import { trashFiles } from '../utils/media-edit.js';
import { notRawCompanion } from '../utils/raw-pairing.js';

// Files a user may treat as their own duplicates: those in libraries they own.
// Shared (view-only) files are excluded so a user can neither see nor delete
// another user's copies. Admins and the internal worker see everything.
async function ownedScope(userId: string | null, session: SessionLike) {
  if (!userId) {
    return {
      isAdmin: true,
      ownedLibraryIds: new Set<string>(),
      filter: notRawCompanion(FileTable.id),
    };
  }
  const scope = await getAccessScope(userId, session);
  const filter = buildFileAccessFilter(
    {
      ...scope,
      accessibleLibraryIds: scope.ownedLibraryIds,
      recursiveAlbumIds: new Set(),
      directFileIds: new Set(),
    },
    FileTable.id,
  );
  // A RAW companion is part of its photo, never a duplicate on its own.
  return {
    isAdmin: scope.isAdmin,
    ownedLibraryIds: scope.ownedLibraryIds,
    filter: and(filter, notRawCompanion(FileTable.id))!,
  };
}

// Deletes run one at a time: the "another copy still exists" check and the
// delete are split by async disk I/O, so two concurrent deletes of the two
// copies in a group could otherwise both pass the check and remove both.
let deleteChain: Promise<unknown> = Promise.resolve();

// Settings > Duplicates is an admin page, so both procedures are admin-only.
export const duplicatesRouter = router({
  list: adminProcedure.query(async ({ ctx: { userId, session } }) => {
    const { filter } = await ownedScope(userId, session);

    // Group within the caller's scope, so a copy only counts as a duplicate of
    // another copy the caller can also see (and delete).
    const dupeHashSubquery = db
      .select({ contentHash: FileTable.contentHash })
      .from(FileTable)
      .where(and(isNotNull(FileTable.contentHash), filter))
      .groupBy(FileTable.contentHash)
      .having(sql`COUNT(*) > 1`);

    const rawFile = alias(FileTable, 'raw_file');
    const files = await db
      .select({
        id: FileTable.id,
        dir: FileTable.dir,
        name: FileTable.name,
        size: FileTable.size,
        type: FileTable.type,
        contentHash: FileTable.contentHash,
        takenAt: FileTable.takenAt,
        createdAt: FileTable.createdAt,
        // A RAW companion stays on disk and becomes its own photo on delete.
        rawName: rawFile.name,
        // Resolution, for the side-by-side compare in Settings > Duplicates.
        width: ImageMetadataTable.width,
        height: ImageMetadataTable.height,
      })
      .from(FileTable)
      .leftJoin(ImageMetadataTable, eq(ImageMetadataTable.fileId, FileTable.id))
      .leftJoin(rawFile, eq(rawFile.id, FileTable.rawFileId))
      .where(and(inArray(FileTable.contentHash, dupeHashSubquery), filter))
      .orderBy(FileTable.contentHash, FileTable.createdAt);

    // Group by hash
    const groups = new Map<string, typeof files>();
    for (const f of files) {
      const hash = f.contentHash!;
      const group = groups.get(hash) ?? [];
      group.push(f);
      groups.set(hash, group);
    }

    return Array.from(groups.entries()).map(([hash, items]) => ({
      contentHash: hash,
      files: items,
    }));
  }),

  // Delete copies: move them to the trash and remove them from the library.
  // A group always keeps at least one copy: a file is refused when every other
  // copy of its content is also in this request (or already gone), so a stale
  // list or a second tab cannot delete the last copy. A RAW companion stays on
  // disk and becomes a photo of its own (the confirm text says so).
  deleteFiles: adminProcedure
    .input(z.object({ fileIds: z.array(z.string().uuid()).min(1).max(5000) }))
    .mutation(async ({ ctx: { userId, session }, input }) => {
      const run = deleteChain.then(async () => {
        const { filter } = await ownedScope(userId, session);
        const wanted = new Set(input.fileIds);
        const targets = await db
          .select({ id: FileTable.id, name: FileTable.name, contentHash: FileTable.contentHash })
          .from(FileTable)
          .where(and(inArray(FileTable.id, input.fileIds), filter));
        const hashes = [...new Set(targets.map((t) => t.contentHash).filter((h): h is string => !!h))];
        const keepers = new Set<string>();
        for (let i = 0; i < hashes.length; i += 500) {
          const rows = await db
            .select({ id: FileTable.id, contentHash: FileTable.contentHash })
            .from(FileTable)
            .where(and(inArray(FileTable.contentHash, hashes.slice(i, i + 500)), filter));
          for (const r of rows) if (!wanted.has(r.id)) keepers.add(r.contentHash!);
        }
        // Every copy of a group requested: keep the first one asked for.
        const refused: { id: string; name: string; reason: string }[] = [];
        for (const t of targets) {
          if (!t.contentHash || !keepers.has(t.contentHash)) {
            refused.push({ id: t.id, name: t.name, reason: 'This is the last copy' });
            if (t.contentHash) keepers.add(t.contentHash);
          }
        }
        const refusedIds = new Set(refused.map((r) => r.id));
        const ok = targets.filter((t) => !refusedIds.has(t.id)).map((t) => t.id);
        const res = await trashFiles(ok, userId, { withRaw: false });
        return { deleted: res.deleted, failed: [...refused, ...res.failed] };
      });
      deleteChain = run.catch(() => {});
      return run;
    }),
});
