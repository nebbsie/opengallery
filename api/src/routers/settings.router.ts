import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import {
  FileTable,
  FileVariantTable,
  SystemSettingsTable,
} from "../db/schema.js";
import { privateProcedure, publicProcedure, router } from "../trpc.js";

export const settingsRouter = router({
  get: privateProcedure.query(async () => {
    const [res] = await db.select().from(SystemSettingsTable).limit(1);
    return res ?? {
      id: '',
      uploadPath: '',
      allowsSelfRegistration: false,
      encodingConcurrency: 5,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }),

  allowsSelfRegistration: publicProcedure.query(async () => {
    const [res] = await db.select().from(SystemSettingsTable).limit(1);
    return res?.allowsSelfRegistration ?? false;
  }),

  update: privateProcedure
    .input(
      z.object({
        allowsSelfRegistration: z.optional(z.boolean()),
        encodingConcurrency: z.optional(z.number().int().min(1).max(64)),
      })
    )
    .mutation(async (ctx) => {
      const [res] = await db
        .update(SystemSettingsTable)
        .set(ctx.input)
        .returning();

      return res;
    }),

  getStorageStats: privateProcedure.query(async () => {
    // Get all original files (not variants) - these are the source media files
    const originalFilesResult = await db
      .select({
        totalSize: sql<string>`COALESCE(SUM(${FileTable.size}), 0)`,
        totalCount: sql<string>`COUNT(*)`,
        imageCount: sql<string>`COUNT(*) FILTER (WHERE ${FileTable.type} = 'image')`,
        videoCount: sql<string>`COUNT(*) FILTER (WHERE ${FileTable.type} = 'video')`,
        imageSize: sql<string>`COALESCE(SUM(${FileTable.size}) FILTER (WHERE ${FileTable.type} = 'image'), 0)`,
        videoSize: sql<string>`COALESCE(SUM(${FileTable.size}) FILTER (WHERE ${FileTable.type} = 'video'), 0)`,
      })
      .from(FileTable)
      .where(
        sql`NOT EXISTS (
          SELECT 1 FROM ${FileVariantTable} 
          WHERE ${FileVariantTable.fileId} = ${FileTable.id}
        )`
      );

    // Get all variant files (thumbnails and optimised versions)
    const variantFilesResult = await db
      .select({
        totalSize: sql<string>`COALESCE(SUM(${FileTable.size}), 0)`,
        totalCount: sql<string>`COUNT(*)`,
        thumbnailCount: sql<string>`COUNT(*) FILTER (WHERE ${FileVariantTable.type} = 'thumbnail')`,
        optimisedCount: sql<string>`COUNT(*) FILTER (WHERE ${FileVariantTable.type} = 'optimised')`,
        thumbnailSize: sql<string>`COALESCE(SUM(${FileTable.size}) FILTER (WHERE ${FileVariantTable.type} = 'thumbnail'), 0)`,
        optimisedSize: sql<string>`COALESCE(SUM(${FileTable.size}) FILTER (WHERE ${FileVariantTable.type} = 'optimised'), 0)`,
      })
      .from(FileVariantTable)
      .innerJoin(FileTable, sql`${FileTable.id} = ${FileVariantTable.fileId}`);

    const original = originalFilesResult[0];
    const variants = variantFilesResult[0];

    return {
      original: {
        totalSize: Number(original?.totalSize ?? 0),
        totalCount: Number(original?.totalCount ?? 0),
        imageCount: Number(original?.imageCount ?? 0),
        videoCount: Number(original?.videoCount ?? 0),
        imageSize: Number(original?.imageSize ?? 0),
        videoSize: Number(original?.videoSize ?? 0),
      },
      variants: {
        totalSize: Number(variants?.totalSize ?? 0),
        totalCount: Number(variants?.totalCount ?? 0),
        thumbnailCount: Number(variants?.thumbnailCount ?? 0),
        optimisedCount: Number(variants?.optimisedCount ?? 0),
        thumbnailSize: Number(variants?.thumbnailSize ?? 0),
        optimisedSize: Number(variants?.optimisedSize ?? 0),
      },
      combined: {
        totalSize:
          Number(original?.totalSize ?? 0) + Number(variants?.totalSize ?? 0),
        totalCount:
          Number(original?.totalCount ?? 0) + Number(variants?.totalCount ?? 0),
      },
    };
  }),
});
