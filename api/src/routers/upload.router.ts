import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { isAdminSession } from "../authz/shared-access.js";
import { strictPrivateProcedure, router } from "../trpc.js";
import {
  CHUNK_BYTES,
  DEFAULT_ALBUM_NAME,
  UploadError,
  cancelUpload,
  createUpload,
  finishUpload,
  getMaxUploadBytes,
  getUploadStatus,
  getUploadsRoot,
  listDestinations,
} from "../uploads/upload-store.js";

const CODE_BY_STATUS: Record<number, TRPCError["code"]> = {
  400: "BAD_REQUEST",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  412: "PRECONDITION_FAILED",
  413: "PAYLOAD_TOO_LARGE",
  415: "UNSUPPORTED_MEDIA_TYPE",
  429: "TOO_MANY_REQUESTS",
};

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof UploadError) {
      throw new TRPCError({
        code: CODE_BY_STATUS[e.status] ?? "INTERNAL_SERVER_ERROR",
        message: e.message,
        cause: e,
      });
    }
    throw e;
  }
}

// Resumable uploads into the caller's own library (uploads/upload-store.ts).
// Any signed-in user may upload into their own uploads folder; "View as" is
// read-only (mutations are refused in trpc.ts). Chunks go to PUT /upload/:id.
export const uploadRouter = router({
  config: strictPrivateProcedure.query(async ({ ctx }) => {
    const root = await getUploadsRoot();
    return {
      enabled: !!root,
      maxBytes: await getMaxUploadBytes(),
      chunkBytes: CHUNK_BYTES,
      defaultAlbumName: DEFAULT_ALBUM_NAME,
      albums: await listDestinations(ctx.userId),
      // Where files land on the server: admin-only detail.
      root: isAdminSession(ctx.session) ? root : null,
    };
  }),

  create: strictPrivateProcedure
    .input(
      z.object({
        name: z.string().min(1).max(1024),
        size: z.number().int().positive(),
        mime: z.string().max(200),
        albumId: z.string().nullish(),
        newAlbumName: z.string().max(200).nullish(),
        // A parent folder for the new album (one level), e.g. "Google Photos".
        folder: z.string().max(100).nullish(),
        // Metadata from an import (e.g. a Google Takeout JSON sidecar). The
        // file's own EXIF wins; these fill the gaps.
        meta: z
          .object({
            source: z.string().max(40),
            takenAt: z.string().datetime().nullish(),
            lat: z.number().min(-90).max(90).nullish(),
            lon: z.number().min(-180).max(180).nullish(),
            description: z.string().max(5000).nullish(),
          })
          .nullish(),
      }),
    )
    .mutation(({ ctx, input }) =>
      run(() => createUpload({ userId: ctx.userId, ...input })),
    ),

  status: strictPrivateProcedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx, input }) => run(() => getUploadStatus(input.id, ctx.userId))),

  finish: strictPrivateProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) => run(() => finishUpload(input.id, ctx.userId))),

  cancel: strictPrivateProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await run(() => cancelUpload(input.id, ctx.userId));
      return { ok: true as const };
    }),
});
