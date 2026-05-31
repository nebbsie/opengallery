import { logger } from '../utils/logger.js';

// The Python InsightFace sidecar (see face-service/). Same container, localhost.
const FACE_SERVICE_URL = process.env['FACE_SERVICE_URL'] ?? 'http://127.0.0.1:3220';

export interface DetectedFace {
  // [x1, y1, x2, y2] in pixels of the image we posted.
  bbox: [number, number, number, number];
  kps: number[][] | null;
  detScore: number;
  // L2-normalized 512-d ArcFace embedding (cosine similarity = dot product).
  embedding: number[];
}

export interface DetectResponse {
  faces: DetectedFace[];
  width: number;
  height: number;
}

/** POST an (already oriented + downscaled) JPEG to the sidecar for detection. */
export async function detectFacesRemote(jpeg: Buffer): Promise<DetectResponse> {
  const form = new FormData();
  form.append('image', new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }), 'image.jpg');

  const res = await fetch(`${FACE_SERVICE_URL}/detect`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`face-service ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as DetectResponse;
}

/** True once the sidecar has loaded its model and is ready to serve. */
export async function faceServiceHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${FACE_SERVICE_URL}/health`);
    if (!res.ok) return false;
    const body = (await res.json()) as { status?: string };
    return body.status === 'ok';
  } catch (e) {
    logger.debug('[face-detection] sidecar health check failed', e as Error);
    return false;
  }
}
