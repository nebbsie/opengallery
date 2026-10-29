import { spawn } from 'node:child_process';
import { join } from 'node:path';
import sharp from 'sharp';
import { getVideoMetadata } from '../utils/ffprobe.js';
import { logger } from '../utils/logger.js';
import { needsPreview } from '../utils/media-types.js';
import { getRawPreview, NoRawPreviewError } from '../utils/raw.js';
import { toContainerPath } from '../utils/paths.js';
import { trpc } from '../utils/trpc.js';
import { createFaceCrop } from './face-crop.js';
import { detectFacesRemote, type DetectedFace } from './face-client.js';

// Long edge of the image sent to the sidecar. Detection itself runs on a
// 1024px copy inside the sidecar, but each face is aligned and embedded from
// these pixels, so small faces in big photos keep their detail.
const SEND_MAX = 2560;
// Drop detections the detector itself doubts; quality decides the rest (see
// api/src/faces/tuning.ts faceQuality).
const MIN_DET_SCORE = 0.6;
// Drop faces too small to recognise at all (pixels in the sent image).
const MIN_FACE_PX = 20;
// Video: sample frames at these points of the duration.
const VIDEO_SAMPLES = [0.1, 0.3, 0.5, 0.7, 0.9];
// Video: two faces from different frames with at least this similarity are
// the same person; only the best view is kept.
const VIDEO_SAME_FACE = 0.5;
const VIDEO_MAX_FACES = 20;
const FFMPEG_FRAME_TIMEOUT_MS = 60_000;

type Frame = { jpeg: Buffer; width: number; height: number };
type Found = { face: DetectedFace; frame: Frame; vec: Float32Array };

function decodeVec(b64: string): Float32Array {
  const buf = Buffer.from(b64, 'base64');
  const v = new Float32Array(buf.length / 4);
  for (let i = 0; i < v.length; i++) v[i] = buf.readFloatLE(i * 4);
  return v;
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

// turn: the clockwise turn the user asked for (file.rotation), after EXIF.
async function imageFrame(sourcePath: string, turn = 0): Promise<Frame> {
  // failOn:'none' so truncated/slightly-corrupt JPEGs still decode (matches
  // the encode pipeline) rather than throwing and failing detection.
  const { data, info } = await sharp(sourcePath, { failOn: 'none' })
    .autoOrient()
    .rotate(turn)
    .removeAlpha()
    .resize({ width: SEND_MAX, height: SEND_MAX, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 92 })
    .toBuffer({ resolveWithObject: true });
  return { jpeg: data, width: info.width, height: info.height };
}

// One JPEG frame at `seconds`. ffmpeg applies the rotation metadata itself.
export function videoFrameAt(path: string, seconds: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const args = [
      '-v', 'error',
      '-ss', seconds.toFixed(2),
      '-i', path,
      '-frames:v', '1',
      '-vf', `scale='min(${SEND_MAX},iw)':-2`,
      '-f', 'image2pipe',
      '-vcodec', 'mjpeg',
      '-q:v', '3',
      'pipe:1',
    ];
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(null);
    }, FFMPEG_FRAME_TIMEOUT_MS);
    child.stdout.on('data', (d) => chunks.push(d as Buffer));
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const buf = Buffer.concat(chunks);
      resolve(code === 0 && buf.length > 0 ? buf : null);
    });
  });
}

async function videoFrames(sourcePath: string): Promise<Frame[]> {
  const meta = await getVideoMetadata(sourcePath);
  const duration = meta.duration ?? 0;
  const points = duration > 2 ? VIDEO_SAMPLES.map((p) => p * duration) : [Math.max(0, duration / 2)];
  const frames: Frame[] = [];
  for (const t of points) {
    const jpeg = await videoFrameAt(sourcePath, t);
    if (!jpeg) continue;
    const info = await sharp(jpeg).metadata();
    if (info.width && info.height) frames.push({ jpeg, width: info.width, height: info.height });
  }
  return frames;
}

function keep(f: DetectedFace): boolean {
  return f.detScore >= MIN_DET_SCORE && f.facePx >= MIN_FACE_PX;
}

// A rough view score for picking the best frame of a person in a video.
const viewScore = (f: DetectedFace) => f.facePx * f.detScore * (1 - Math.min(0.9, f.yaw));

/**
 * Run face detection + recognition for one photo or video, then hand all its
 * faces to the API in one call (faces.ingestFileFaces), which matches them to
 * people and keeps earlier answers on a rescan. Writes an avatar crop per face
 * and marks the file's detect_faces task succeeded/failed.
 */
export async function detectFaces(fileId: string): Promise<void> {
  const fileResult = await trpc.files.getFileById.query(fileId);
  const file = fileResult.raw;

  try {
    const settings = await trpc.settings.get.query();
    const variantsPath = settings?.variantsPath ?? settings?.uploadPath ?? null;
    const sourcePath = toContainerPath(join(file.dir, file.name));

    let model = '';
    let found: Found[] = [];
    if (file.type === 'image') {
      // A camera RAW is read through its embedded JPEG preview (utils/raw.ts).
      const frame = await imageFrame(
        needsPreview(file.name) ? await getRawPreview(file, variantsPath) : sourcePath,
        file.rotation ?? 0,
      );
      const result = await detectFacesRemote(frame.jpeg);
      model = result.model;
      found = result.faces.filter(keep).map((face) => ({ face, frame, vec: new Float32Array(0) }));
    } else {
      const frames = await videoFrames(sourcePath);
      const all: Found[] = [];
      for (const frame of frames) {
        const result = await detectFacesRemote(frame.jpeg);
        model = result.model;
        for (const face of result.faces.filter(keep)) {
          all.push({ face, frame, vec: decodeVec(face.embedding) });
        }
      }
      // One face per person per video: keep each person's best view.
      all.sort((a, b) => viewScore(b.face) - viewScore(a.face));
      for (const f of all) {
        if (found.length >= VIDEO_MAX_FACES) break;
        if (!found.some((g) => dot(g.vec, f.vec) >= VIDEO_SAME_FACE)) found.push(f);
      }
    }

    if (!model) {
      // A video with no decodable frame: nothing to scan.
      await trpc.fileTask.setStatusByFileAndType.mutate({ fileId, type: 'detect_faces', status: 'skipped' });
      return;
    }

    // Always ingest, even with no faces: that clears faces from an earlier scan.
    const { faces } = await trpc.faces.ingestFileFaces.mutate({
      fileId,
      model,
      faces: found.map(({ face: f, frame }) => {
        const [x1, y1, x2, y2] = f.bbox;
        const clamp = (v: number) => Math.max(0, Math.min(1, v));
        return {
          box: {
            x: clamp(x1 / frame.width),
            y: clamp(y1 / frame.height),
            width: clamp((x2 - x1) / frame.width),
            height: clamp((y2 - y1) / frame.height),
          },
          embedding: f.embedding,
          detScore: f.detScore,
          facePx: f.facePx,
          blur: f.blur,
          yaw: f.yaw,
        };
      }),
    });
    if (found.length > 0) logger.info(`[face-detection] found ${found.length} face(s) in ${fileId}`);

    if (variantsPath) {
      for (let i = 0; i < faces.length; i++) {
        const { face: f, frame } = found[i]!;
        const [x1, y1, x2, y2] = f.bbox;
        const crop = await createFaceCrop({
          faceId: faces[i]!.faceId,
          source: frame.jpeg,
          box: {
            x: x1 / frame.width,
            y: y1 / frame.height,
            width: (x2 - x1) / frame.width,
            height: (y2 - y1) / frame.height,
          },
          variantsPath,
        });
        if (crop) {
          await trpc.faces.setFaceCrop.mutate({
            faceId: faces[i]!.faceId,
            cropDir: crop.cropDir,
            cropName: crop.cropName,
          });
        }
      }
    }

    await trpc.fileTask.setStatusByFileAndType.mutate({
      fileId,
      type: 'detect_faces',
      status: 'succeeded',
    });
  } catch (e) {
    if (e instanceof NoRawPreviewError) {
      // Nothing to look at; a retry cannot help.
      logger.warn(`[face-detection] ${e.message}, skipping fileId=${fileId}`);
      await trpc.fileTask.setStatusByFileAndType.mutate({ fileId, type: 'detect_faces', status: 'skipped' });
      return;
    }
    logger.error(`[face-detection] failed for fileId=${fileId}`, e as Error);
    await trpc.fileTask.setStatusByFileAndType.mutate({
      fileId,
      type: 'detect_faces',
      status: 'failed',
      error: (e as Error)?.message,
      incrementAttempts: true,
    });
  }
}
