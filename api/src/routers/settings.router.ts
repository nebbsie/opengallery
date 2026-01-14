import { sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import { db } from "../db/index.js";
import {
  FileTable,
  FileVariantTable,
  SystemSettingsTable,
} from "../db/schema.js";
import { privateProcedure, publicProcedure, router } from "../trpc.js";

export interface StorageStats {
  original: {
    totalSize: number;
    totalCount: number;
    imageCount: number;
    videoCount: number;
    imageSize: number;
    videoSize: number;
  };
  variants: {
    totalSize: number;
    totalCount: number;
    thumbnailCount: number;
    optimisedCount: number;
    thumbnailSize: number;
    optimisedSize: number;
  };
  combined: {
    totalSize: number;
    totalCount: number;
  };
}

export const settingsRouter = router({
  get: privateProcedure.query(async () => {
    const [res] = await db.select().from(SystemSettingsTable).limit(1);
    return (
      res ?? {
        id: "",
        uploadPath: "",
        allowsSelfRegistration: false,
        encodingConcurrency: 5,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    );
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

  getStorageStats: privateProcedure.query<StorageStats>(async () => {
    const fv = alias(FileVariantTable, "fv");

    const result = await db
      .select({
        originalTotalSize: sql<number>`COALESCE(SUM(${FileTable.size}) FILTER (WHERE ${fv.id} IS NULL), 0)`,
        originalTotalCount: sql<number>`COUNT(*) FILTER (WHERE ${fv.id} IS NULL)`,
        originalImageCount: sql<number>`COUNT(*) FILTER (WHERE ${fv.id} IS NULL AND ${FileTable.type} = 'image')`,
        originalVideoCount: sql<number>`COUNT(*) FILTER (WHERE ${fv.id} IS NULL AND ${FileTable.type} = 'video')`,
        originalImageSize: sql<number>`COALESCE(SUM(${FileTable.size}) FILTER (WHERE ${fv.id} IS NULL AND ${FileTable.type} = 'image'), 0)`,
        originalVideoSize: sql<number>`COALESCE(SUM(${FileTable.size}) FILTER (WHERE ${fv.id} IS NULL AND ${FileTable.type} = 'video'), 0)`,
        variantTotalSize: sql<number>`COALESCE(SUM(${FileTable.size}) FILTER (WHERE ${fv.id} IS NOT NULL), 0)`,
        variantTotalCount: sql<number>`COUNT(*) FILTER (WHERE ${fv.id} IS NOT NULL)`,
        thumbnailCount: sql<number>`COUNT(*) FILTER (WHERE ${fv.type} = 'thumbnail')`,
        optimisedCount: sql<number>`COUNT(*) FILTER (WHERE ${fv.type} = 'optimised')`,
        thumbnailSize: sql<number>`COALESCE(SUM(${FileTable.size}) FILTER (WHERE ${fv.type} = 'thumbnail'), 0)`,
        optimisedSize: sql<number>`COALESCE(SUM(${FileTable.size}) FILTER (WHERE ${fv.type} = 'optimised'), 0)`,
      })
      .from(FileTable)
      .leftJoin(fv, sql`${FileTable.id} = ${fv.fileId}`);

    const row = result[0];

    const stats: StorageStats = {
      original: {
        totalSize: Number(row?.originalTotalSize ?? 0),
        totalCount: Number(row?.originalTotalCount ?? 0),
        imageCount: Number(row?.originalImageCount ?? 0),
        videoCount: Number(row?.originalVideoCount ?? 0),
        imageSize: Number(row?.originalImageSize ?? 0),
        videoSize: Number(row?.originalVideoSize ?? 0),
      },
      variants: {
        totalSize: Number(row?.variantTotalSize ?? 0),
        totalCount: Number(row?.variantTotalCount ?? 0),
        thumbnailCount: Number(row?.thumbnailCount ?? 0),
        optimisedCount: Number(row?.optimisedCount ?? 0),
        thumbnailSize: Number(row?.thumbnailSize ?? 0),
        optimisedSize: Number(row?.optimisedSize ?? 0),
      },
      combined: {
        totalSize:
          Number(row?.originalTotalSize ?? 0) +
          Number(row?.variantTotalSize ?? 0),
        totalCount:
          Number(row?.originalTotalCount ?? 0) +
          Number(row?.variantTotalCount ?? 0),
      },
    };

    return stats;
  }),
});
