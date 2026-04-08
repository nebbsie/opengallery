import { eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { exec } from "child_process";
import { mkdir } from "fs/promises";
import { promisify } from "util";
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
        variantsPath: null,
        allowsSelfRegistration: false,
        encodingConcurrency: 2,
        ioConcurrency: 2,
        thumbnailQuality: 70,
        optimizedQuality: 80,
        gpuEncoding: false,
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
        ioConcurrency: z.optional(z.number().int().min(1).max(10)),
        thumbnailQuality: z.optional(z.number().int().min(1).max(100)),
        optimizedQuality: z.optional(z.number().int().min(1).max(100)),
        gpuEncoding: z.optional(z.boolean()),
        selectedGpu: z.optional(z.string().nullable()),
        uploadPath: z.optional(z.string().nullable()),
        variantsPath: z.optional(z.string().nullable()),
      })
    )
    .mutation(async (ctx) => {
      // Create directories if paths are being set
      if (ctx.input.uploadPath) {
        await mkdir(ctx.input.uploadPath, { recursive: true }).catch(() => { });
      }
      if (ctx.input.variantsPath) {
        await mkdir(ctx.input.variantsPath, { recursive: true }).catch(() => { });
      }

      // Check if row exists
      const [existing] = await db.select().from(SystemSettingsTable).limit(1);

      if (existing) {
        // Update existing row
        const [res] = await db
          .update(SystemSettingsTable)
          .set({ ...ctx.input, updatedAt: new Date().toISOString() })
          .where(eq(SystemSettingsTable.id, existing.id))
          .returning();
        return res;
      } else {
        // Insert new row with defaults + input
        const [res] = await db
          .insert(SystemSettingsTable)
          .values({
            uploadPath: null,
            variantsPath: null,
            allowsSelfRegistration: false,
            encodingConcurrency: 2,
            ioConcurrency: 2,
            thumbnailQuality: 70,
            optimizedQuality: 80,
            gpuEncoding: false,
            ...ctx.input,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })
          .returning();
        return res;
      }
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

  getEncoderInfo: privateProcedure.query(async () => {
    const execAsync = promisify(exec);

    try {
      // Check for NVENC support (cross-platform command)
      const { stdout, stderr } = await execAsync('ffmpeg -encoders');
      const output = stdout + stderr;
      const hasNvenc = output.includes('h264_nvenc');
      const hasVideotoolbox = output.includes('h264_videotoolbox'); // macOS
      const hasVaapi = output.includes('h264_vaapi'); // Intel/AMD Linux

      const gpus: Array<{ id: string; name: string; encoder: string }> = [];

      // Detect NVIDIA GPUs
      if (hasNvenc) {
        try {
          const { stdout: nvidiaStdout } = await execAsync('nvidia-smi --query-gpu=index,name --format=csv,noheader');
          const nvidiaGpus = nvidiaStdout.trim().split('\n').filter(line => line.trim());
          for (const gpuLine of nvidiaGpus) {
            const parts = gpuLine.split(',');
            if (parts.length >= 2) {
              const index = parts[0]?.trim();
              const name = parts[1]?.trim();
              if (index && name) {
                gpus.push({ id: `nvidia:${index}`, name: `NVIDIA ${name}`, encoder: 'h264_nvenc' });
              }
            }
          }
        } catch {
          // Single GPU or nvidia-smi failed
          gpus.push({ id: 'nvidia:0', name: 'NVIDIA GPU', encoder: 'h264_nvenc' });
          // Check if NVIDIA runtime is available via environment or fallback
        }
      }

      // Detect Intel/AMD VAAPI
      if (hasVaapi) {
        gpus.push({ id: 'vaapi', name: 'Intel/AMD GPU (VAAPI)', encoder: 'h264_vaapi' });
      }

      // Detect Apple VideoToolbox
      if (hasVideotoolbox) {
        gpus.push({ id: 'videotoolbox', name: 'Apple Silicon/Intel Mac', encoder: 'h264_videotoolbox' });
      }

      // Always add CPU fallback
      gpus.push({ id: 'cpu', name: 'CPU (Software)', encoder: 'libx264' });

      return {
        availableEncoders: {
          nvenc: hasNvenc,
          videotoolbox: hasVideotoolbox,
          vaapi: hasVaapi,
          cpu: true,
        },
        detectedGpus: gpus,
        defaultGpu: gpus.find(g => g.id.startsWith('nvidia'))?.id ??
                    gpus.find(g => g.id === 'vaapi')?.id ??
                    gpus.find(g => g.id === 'videotoolbox')?.id ??
                    'cpu',
      };
    } catch (e) {
      // FFmpeg not available
      console.error('[getEncoderInfo] FFmpeg detection failed:', e);
      return {
        availableEncoders: {
          nvenc: false,
          videotoolbox: false,
          vaapi: false,
          cpu: false,
        },
        detectedGpus: [{ id: 'cpu', name: 'CPU (Software)', encoder: 'libx264' }],
        defaultGpu: 'cpu',
        error: String(e),
      };
    }
  }),
});
