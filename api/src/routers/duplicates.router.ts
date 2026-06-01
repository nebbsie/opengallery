import * as fs from 'node:fs';
import path from 'node:path';
import { inArray, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index.js';
import { FileTable } from '../db/schema.js';
import { privateProcedure, router } from '../trpc.js';
import { deleteFilesWithCascade } from '../utils/file-operations.js';
import { resolveAssetPath } from '../utils/media-path.js';

export const duplicatesRouter = router({
  list: privateProcedure.query(async () => {
    const dupeHashSubquery = db
      .select({ contentHash: FileTable.contentHash })
      .from(FileTable)
      .where(isNotNull(FileTable.contentHash))
      .groupBy(FileTable.contentHash)
      .having(sql`COUNT(*) > 1`);

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
      })
      .from(FileTable)
      .where(inArray(FileTable.contentHash, dupeHashSubquery))
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

  deleteFile: privateProcedure
    .input(z.object({ fileId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const [file] = await db
        .select({ dir: FileTable.dir, name: FileTable.name })
        .from(FileTable)
        .where(sql`${FileTable.id} = ${input.fileId}`)
        .limit(1);

      if (!file) throw new Error('File not found');

      const abs = path.resolve(path.join(file.dir, file.name));
      try {
        const resolved = await resolveAssetPath(abs);
        await fs.promises.unlink(resolved);
      } catch {
        // Best-effort: already deleted or path unresolvable
      }

      await deleteFilesWithCascade([input.fileId]);
      return { ok: true } as const;
    }),
});
