import { join } from 'node:path';
import pLimit from 'p-limit';
import sharp from 'sharp';
import { faceServiceHealthy } from './face-detection/face-client.js';
import { videoFrameAt } from './face-detection/detect.js';
import { getVideoMetadata } from './utils/ffprobe.js';
import { logger } from './utils/logger.js';
import { needsPreview } from './utils/media-types.js';
import { getRawPreview, NoRawPreviewError } from './utils/raw.js';
import { toContainerPath } from './utils/paths.js';
import { trpc } from './utils/trpc.js';

// Object search: one image-text embedding per photo or video, made by the
// sidecar (/clip/image) and stored by the API (clip.setEmbedding). Runs in its
// own loop like face detection, so it never competes with encoding.

const ML_SERVICE_URL = process.env['FACE_SERVICE_URL'] ?? 'http://127.0.0.1:3220';
// The models look at 224px; a little more keeps resizing quality up.
const SEND_MAX = 448;
const CONCURRENCY = 2;

class ModelMissing extends Error {}

async function embedImage(jpeg: Buffer): Promise<{ model: string; embedding: string }> {
  const form = new FormData();
  form.append('image', new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }), 'image.jpg');
  const res = await fetch(`${ML_SERVICE_URL}/clip/image`, { method: 'POST', body: form });
  if (res.status === 503) throw new ModelMissing(await res.text().catch(() => 'model missing'));
  if (!res.ok) throw new Error(`clip ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  return (await res.json()) as { model: string; embedding: string };
}

async function frameFor(file: {
  type: string;
  dir: string;
  name: string;
  contentHash: string | null;
  rotation?: number;
}): Promise<Buffer | null> {
  const path = toContainerPath(join(file.dir, file.name));
  let source: Buffer | string = path;
  if (file.type === 'image' && needsPreview(file.name)) {
    // A camera RAW is read through its embedded JPEG preview (utils/raw.ts),
    // usually cached by the encode step already.
    const settings = await trpc.settings.get.query();
    source = await getRawPreview(file, settings?.variantsPath ?? settings?.uploadPath ?? null);
  } else if (file.type === 'video') {
    // One frame from a third of the way in: past intros and fades.
    const meta = await getVideoMetadata(path);
    const frame = await videoFrameAt(path, Math.max(0, (meta.duration ?? 0) / 3));
    if (!frame) return null;
    source = frame;
  }
  // A video frame is upright already; a photo takes the user's turn too.
  return sharp(source, { failOn: 'none' })
    .autoOrient()
    .rotate(file.type === 'image' ? (file.rotation ?? 0) : 0)
    .removeAlpha()
    .resize({ width: SEND_MAX, height: SEND_MAX, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer();
}

async function embedFile(fileId: string): Promise<void> {
  const file = (await trpc.files.getFileById.query(fileId)).raw;
  try {
    const jpeg = await frameFor(file);
    if (!jpeg) {
      await trpc.fileTask.setStatusByFileAndType.mutate({ fileId, type: 'embed_clip', status: 'skipped' });
      return;
    }
    const { model, embedding } = await embedImage(jpeg);
    await trpc.clip.setEmbedding.mutate({ fileId, model, embedding });
    await trpc.fileTask.setStatusByFileAndType.mutate({ fileId, type: 'embed_clip', status: 'succeeded' });
  } catch (e) {
    if (e instanceof NoRawPreviewError) {
      await trpc.fileTask.setStatusByFileAndType.mutate({ fileId, type: 'embed_clip', status: 'skipped' });
      return;
    }
    if (e instanceof ModelMissing) {
      // Not this file's fault: put it back without using an attempt.
      await trpc.fileTask.setStatusByFileAndType.mutate({ fileId, type: 'embed_clip', status: 'pending' });
      throw e;
    }
    logger.warn(`[clip] failed for fileId=${fileId}`, e as Error);
    await trpc.fileTask.setStatusByFileAndType.mutate({
      fileId,
      type: 'embed_clip',
      status: 'failed',
      error: (e as Error)?.message,
      incrementAttempts: true,
    });
  }
}

export function runClipWorker(): void {
  const limit = pLimit(CONCURRENCY);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const loop = async () => {
    while (!(await faceServiceHealthy())) await sleep(2000);
    try {
      const { seeded, revived } = await trpc.clip.backfillTasks.mutate();
      if (seeded || revived) logger.info(`[clip] backfill: seeded=${seeded} revived=${revived}`);
    } catch (e) {
      logger.warn('[clip] backfill failed', e as Error);
    }

    while (true) {
      try {
        const fileIds = await trpc.clip.leaseFiles.mutate();
        if (fileIds.length === 0) {
          await sleep(3000);
          continue;
        }
        const results: PromiseSettledResult<void>[] = await Promise.allSettled(
          fileIds.map((id: string) => limit(() => embedFile(id))),
        );
        if (results.some((r) => r.status === 'rejected' && r.reason instanceof ModelMissing)) {
          logger.warn('[clip] sidecar has no image-text model; object search indexing paused for 10 min');
          await sleep(10 * 60_000);
        }
      } catch (e) {
        logger.error('[clip] lease loop error', e as Error);
        await sleep(1000 + Math.floor(Math.random() * 500));
      }
    }
  };
  void loop();
}
