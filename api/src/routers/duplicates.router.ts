import * as fs from 'node:fs';
import path from 'node:path';
import { TRPCError } from '@trpc/server';
import { type SQL, and, eq, inArray, isNotNull, isNull, ne, notInArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { z } from 'zod';
import {
  type SessionLike,
  buildFileAccessFilter,
  getAccessScope,
} from '../authz/shared-access.js';
import { db } from '../db/index.js';
import { FileTable, ImageMetadataTable, LibraryFileTable } from '../db/schema.js';
import { adminProcedure, router } from '../trpc.js';
import { deleteFilesWithCascade } from '../utils/file-operations.js';
import { resolveAssetPath } from '../utils/media-path.js';
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

  deleteFile: adminProcedure
    .input(z.object({ fileId: z.string().uuid() }))
    .mutation(async ({ ctx: { userId, session }, input }) => {
      const run = deleteChain.then(async () => {
        const scope = await ownedScope(userId, session);

        const [file] = await db
          .select({
            dir: FileTable.dir,
            name: FileTable.name,
            contentHash: FileTable.contentHash,
            rawFileId: FileTable.rawFileId,
          })
          .from(FileTable)
          .where(and(sql`${FileTable.id} = ${input.fileId}`, scope.filter))
          .limit(1);

        if (!file) throw new Error('File not found');

        // The caller must own every live library entry of this file. One
        // file row can sit in several users' libraries (overlapping paths),
        // and the unlink below removes it from disk for all of them.
        if (!scope.isAdmin) {
          const owned = [...scope.ownedLibraryIds];
          const [foreign] = await db
            .select({ id: LibraryFileTable.id })
            .from(LibraryFileTable)
            .where(
              and(
                eq(LibraryFileTable.fileId, input.fileId),
                isNull(LibraryFileTable.deletedAt),
                ...(owned.length > 0 ? [notInArray(LibraryFileTable.libraryId, owned)] : []),
              ),
            )
            .limit(1);
          if (foreign) throw new TRPCError({ code: 'FORBIDDEN' });
        }

        // Never delete the last copy: another file with the same hash must
        // still exist in the caller's scope (a stale list or a second tab can
        // otherwise delete every copy in a group).
        if (!file.contentHash) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'File has no content hash' });
        }
        const [other] = await db
          .select({ id: FileTable.id })
          .from(FileTable)
          .where(
            and(
              eq(FileTable.contentHash, file.contentHash),
              ne(FileTable.id, input.fileId),
              scope.filter,
            ),
          )
          .limit(1);
        if (!other) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'No other copy of this file exists' });
        }

        const abs = path.resolve(path.join(file.dir, file.name));
        try {
          const resolved = await resolveAssetPath(abs);
          await fs.promises.unlink(resolved);
        } catch {
          // Best-effort: already deleted or path unresolvable
        }

        // A RAW+JPEG pair: never delete the RAW, it can be the only copy of
        // that file. deleteFilesWithCascade promotes it to a photo of its own,
        // so the user sees it and decides (the confirm text says so).
        const ids = [input.fileId];
        await deleteFilesWithCascade(ids);
        return { ok: true } as const;
      });
      deleteChain = run.catch(() => {});
      return run;
    }),
});
