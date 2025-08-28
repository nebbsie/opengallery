import { internalProcedure, privateProcedure, router } from "../trpc.js";
import { z } from "zod";
import { db } from "../db/index.js";
import {
  FileTable,
  FileVariantTable,
  LibraryFileTable,
  LibraryTable,
} from "../db/schema.js";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { TasksQueue } from "../redis.js";

export const filesRouter = router({
  create: internalProcedure
    .input(
      z.array(
        z.object({
          dir: z.string(),
          name: z.string(),
          type: z.enum(["image", "video"]),
          mime: z.string(),
          size: z.number(),
        }),
      ),
    )
    .mutation(async ({ input }) => {
      const addedFiles = await db.insert(FileTable).values(input).returning();

      type Message = {
        name: "encode";
        data: {
          fileId: string;
        };
      };

      const tasks: Message[] = addedFiles.map((f) => ({
        name: "encode",
        data: { fileId: f.id },
      }));

      await TasksQueue.addBulk(tasks);

      return addedFiles;
    }),

  getFilesInDir: privateProcedure
    .input(z.string())
    .mutation(({ input }) =>
      db.select().from(FileTable).where(eq(FileTable.dir, input)),
    ),

  removeFilesById: internalProcedure
    .input(z.array(z.string()))
    .mutation(({ input }) =>
      db.delete(FileTable).where(inArray(FileTable.id, input)),
    ),

  getAllFiles: internalProcedure.query(() => db.select().from(FileTable)),

  saveVariants: internalProcedure
    .input(
      z.object({
        originalFileId: z.string().uuid(),
        variants: z
          .array(
            z.object({
              type: z.enum(["thumbnail", "optimised"]),
              fileType: z.enum(["image", "video"]),
              dir: z.string(),
              name: z.string(), // e.g. `${base}__thumb.avif`
              mime: z.string(),
              size: z.number().int().nonnegative(),
            }),
          )
          .min(1)
          .max(2),
      }),
    )
    .mutation(async ({ input }) => {
      const { originalFileId, variants } = input;

      return db.transaction(async (tx) => {
        const result: {
          originalFileId: string;
          thumbnail: null | { id: string; dir: string; name: string };
          optimised: null | { id: string; dir: string; name: string };
        } = { originalFileId, thumbnail: null, optimised: null };

        for (const v of variants) {
          const [res] = await tx
            .insert(FileTable)
            .values({
              dir: v.dir,
              name: v.name,
              mime: v.mime,
              size: v.size,
              type: v.fileType,
            })
            .returning({ id: FileTable.id });

          if (!res || !res.id) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to insert variant file",
            });
          }

          await tx.insert(FileVariantTable).values({
            originalFileId,
            fileId: res.id,
            type: v.type,
          });

          result[v.type] = { id: res.id, dir: v.dir, name: v.name };
        }

        return result;
      });
    }),

  getFileById: internalProcedure.input(z.string()).query(async ({ input }) => {
    const [file] = await db
      .select()
      .from(FileTable)
      .where(eq(FileTable.id, input))
      .limit(1);
    if (!file) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `Failed to find file by id: ${input}`,
      });
    }

    const variants = await db
      .select()
      .from(FileVariantTable)
      .where(
        and(
          eq(FileVariantTable.fileId, file.id),
          inArray(FileVariantTable.type, ["thumbnail", "optimised"]),
        ),
      );

    const thumbnail = variants.find((v) => v.type === "thumbnail") ?? null;
    const optimized = variants.find((v) => v.type === "optimised") ?? null;

    return { raw: file, thumbnail, optimized };
  }),

  getUsersFiles: privateProcedure
    .input(z.enum(["all", "video", "photo"]))
    .query(async ({ ctx: { userId }, input }) => {
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });

      const rows = await db
        .select({
          file: FileTable,
          libraryId: LibraryTable.id,
          libraryFileId: LibraryFileTable.id,
        })
        .from(LibraryFileTable)
        .innerJoin(FileTable, eq(FileTable.id, LibraryFileTable.fileId))
        .innerJoin(
          LibraryTable,
          eq(LibraryTable.id, LibraryFileTable.libraryId),
        )
        .where(
          input === "all"
            ? and(
                eq(LibraryTable.userId, userId),
                isNull(LibraryFileTable.deletedAt),
              )
            : and(
                eq(LibraryTable.userId, userId),
                isNull(LibraryFileTable.deletedAt),
                eq(FileTable.type, input === "photo" ? "image" : "video"),
              ),
        )
        .orderBy(desc(FileTable.createdAt));

      return rows.map((r) => ({
        ...r.file,
        libraryId: r.libraryId,
        libraryFileId: r.libraryFileId,
      }));
    }),
});
