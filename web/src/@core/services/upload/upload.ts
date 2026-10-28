import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { PluralPipe } from '@core/pipes/plural.pipe';
import { CacheKey } from '@core/services/cache-key.types';
import { ToastService } from '@core/services/toast/toast';
import { injectTrpc } from '@core/services/trpc';
import { environment } from '@env/environment';
import { QueryClient } from '@tanstack/angular-query-experimental';

export type UploadDestination =
  | { kind: 'default' }
  | { kind: 'album'; albumId: string; name: string }
  // folder: a parent folder for the new album, e.g. "Google Photos".
  | { kind: 'new'; name: string; folder?: string };

// Metadata sent with an upload, e.g. a Google Takeout JSON sidecar. The
// server keeps it and uses it where the file has no EXIF date or position.
export interface UploadMeta {
  source: string;
  takenAt: string | null;
  lat: number | null;
  lon: number | null;
  description: string | null;
}

// An upload whose bytes are read only when it starts (e.g. an entry of a
// 50 GB zip): open() is called once per attempt and the Blob is dropped when
// the upload ends.
export interface LazyUpload {
  name: string;
  size: number;
  type: string;
  open: () => Promise<Blob>;
  destination: UploadDestination;
  meta?: UploadMeta | null;
}

export type UploadState =
  | 'queued'
  | 'uploading'
  | 'paused'
  | 'finishing'
  | 'done'
  | 'duplicate'
  | 'error'
  | 'cancelled';

export interface UploadItem {
  readonly id: number;
  readonly batch: number;
  // Null for a lazy item until its upload starts (and again after it ends).
  readonly file: Blob | null;
  readonly open: (() => Promise<Blob>) | null;
  readonly type: string;
  readonly meta: UploadMeta | null;
  // No result toast for the batch (the importer reports itself).
  readonly quiet: boolean;
  readonly name: string;
  readonly size: number;
  readonly destination: UploadDestination;
  state: UploadState;
  // Bytes the server has confirmed, plus the bytes of the chunk in flight.
  sent: number;
  error: string | null;
  sessionId: string | null;
  albumId: string | null;
}

const CONCURRENCY = 3;
const DEFAULT_CHUNK = 8 * 1024 * 1024;
// Automatic retries of one chunk on a dropped connection before the file is
// marked failed (the user can still press Retry).
const AUTO_RETRIES = 6;

class ChunkError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    readonly received: number | null,
  ) {
    super(message);
  }
}

class Aborted extends Error {}

const plural = new PluralPipe();

function errorMessage(e: unknown): string {
  const msg = (e as { message?: string } | null)?.message;
  return msg && msg !== 'TRPC request failed' ? msg : 'Upload failed. Try again.';
}

// Uploads files in resumable chunks (API: upload.* over tRPC plus
// PUT /upload/:id?offset=N). A root service, so uploads keep going while the
// user moves between pages; the panel (upload-panel.ts) only renders state.
@Injectable({ providedIn: 'root' })
export class UploadService {
  private readonly trpc = injectTrpc();
  private readonly queryClient = inject(QueryClient);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private nextId = 1;
  private nextBatch = 1;
  private chunkBytes = DEFAULT_CHUNK;
  private readonly xhrs = new Map<number, XMLHttpRequest>();
  private readonly running = new Set<number>();
  private invalidateTimer: ReturnType<typeof setTimeout> | null = null;
  private speedTimer: ReturnType<typeof setInterval> | null = null;
  private lastSample: { at: number; bytes: number } | null = null;
  // Batches whose result toast has been shown.
  private readonly reported = new Set<number>();

  readonly items = signal<readonly UploadItem[]>([]);
  // Bytes per second over the last few seconds.
  readonly speed = signal(0);
  readonly panelOpen = signal(false);
  readonly expanded = signal(true);
  // Opens the picker dialog; set by the host that owns the dialog.
  readonly pickerRequest = signal(0);

  readonly active = computed(() =>
    this.items().filter((i) => i.state === 'queued' || i.state === 'uploading' || i.state === 'finishing'),
  );
  readonly isBusy = computed(() => this.active().length > 0);
  readonly totals = computed(() => {
    let size = 0;
    let sent = 0;
    let done = 0;
    let failed = 0;
    let paused = 0;
    let count = 0;
    for (const i of this.items()) {
      if (i.state === 'cancelled') continue;
      count++;
      size += i.size;
      sent += i.state === 'done' || i.state === 'duplicate' ? i.size : i.sent;
      if (i.state === 'done' || i.state === 'duplicate') done++;
      if (i.state === 'error') failed++;
      if (i.state === 'paused') paused++;
    }
    return { size, sent, done, failed, paused, count };
  });

  constructor() {
    if (this.isBrowser) {
      // Closing the tab would lose the files that are still uploading.
      window.addEventListener('beforeunload', (e) => {
        if (this.isBusy()) {
          e.preventDefault();
          e.returnValue = '';
        }
      });
    }
  }

  openPicker(): void {
    this.pickerRequest.update((n) => n + 1);
  }

  enqueue(files: readonly File[], destination: UploadDestination, maxBytes?: number): void {
    if (!files.length) return;
    const batch = this.nextBatch++;
    const added: UploadItem[] = files.map((file) => {
      const tooBig = maxBytes !== undefined && file.size > maxBytes;
      const empty = file.size === 0;
      return {
        id: this.nextId++,
        batch,
        file,
        open: null,
        type: file.type,
        meta: null,
        quiet: false,
        name: file.name,
        size: file.size,
        destination,
        state: tooBig || empty ? 'error' : 'queued',
        sent: 0,
        error: empty ? 'The file is empty' : tooBig ? 'Larger than the upload limit' : null,
        sessionId: null,
        albumId: null,
      };
    });
    this.items.update((list) => [...list, ...added]);
    this.panelOpen.set(true);
    this.expanded.set(true);
    this.pump();
  }

  // Queue lazy uploads (see LazyUpload) with no result toast; returns their
  // ids so the caller can follow them and remove() them when they end.
  enqueueLazy(uploads: readonly LazyUpload[]): number[] {
    if (!uploads.length) return [];
    const batch = this.nextBatch++;
    const added: UploadItem[] = uploads.map((u) => ({
      id: this.nextId++,
      batch,
      file: null,
      open: u.open,
      type: u.type,
      meta: u.meta ?? null,
      quiet: true,
      name: u.name,
      size: u.size,
      destination: u.destination,
      state: u.size === 0 ? 'error' : 'queued',
      sent: 0,
      error: u.size === 0 ? 'The file is empty' : null,
      sessionId: null,
      albumId: null,
    }));
    this.items.update((list) => [...list, ...added]);
    this.pump();
    return added.map((i) => i.id);
  }

  // Drop rows that are no longer running (finished, failed, cancelled).
  remove(ids: readonly number[]): void {
    const drop = new Set(ids);
    this.items.update((list) =>
      list.filter(
        (i) => !drop.has(i.id) || i.state === 'queued' || i.state === 'uploading' || i.state === 'finishing',
      ),
    );
    if (!this.items().length) this.panelOpen.set(false);
  }

  pause(id: number): void {
    const item = this.get(id);
    if (!item || (item.state !== 'uploading' && item.state !== 'queued')) return;
    this.patch(id, { state: 'paused' });
    this.xhrs.get(id)?.abort();
    this.pump();
  }

  resume(id: number): void {
    const item = this.get(id);
    if (!item || (item.state !== 'paused' && item.state !== 'error')) return;
    this.patch(id, { state: 'queued', error: null });
    this.pump();
  }

  retry(id: number): void {
    this.resume(id);
  }

  pauseAll(): void {
    for (const i of this.items()) if (i.state === 'uploading' || i.state === 'queued') this.pause(i.id);
  }

  resumeAll(): void {
    for (const i of this.items()) if (i.state === 'paused') this.resume(i.id);
  }

  retryFailed(): void {
    for (const i of this.items()) if (i.state === 'error') this.resume(i.id);
  }

  cancel(id: number): void {
    const item = this.get(id);
    if (!item || item.state === 'done' || item.state === 'duplicate' || item.state === 'cancelled') return;
    this.patch(id, { state: 'cancelled' });
    this.xhrs.get(id)?.abort();
    if (item.sessionId) {
      this.trpc.upload.cancel.mutate({ id: item.sessionId }).catch(() => {});
    }
    this.pump();
    this.maybeFinishBatch(item.batch);
  }

  cancelAll(): void {
    for (const i of this.items()) this.cancel(i.id);
  }

  // Drop finished, failed and cancelled rows; close the panel when empty.
  clearFinished(): void {
    this.items.update((list) =>
      list.filter((i) => i.state === 'queued' || i.state === 'uploading' || i.state === 'finishing' || i.state === 'paused'),
    );
    if (!this.items().length) this.panelOpen.set(false);
  }

  close(): void {
    if (this.isBusy()) return;
    this.items.set([]);
    this.panelOpen.set(false);
  }

  // ---------- internals ----------

  private get(id: number): UploadItem | undefined {
    return this.items().find((i) => i.id === id);
  }

  private patch(id: number, changes: Partial<UploadItem>): void {
    this.items.update((list) => list.map((i) => (i.id === id ? { ...i, ...changes } : i)));
  }

  private pump(): void {
    for (const item of this.items()) {
      if (this.running.size >= CONCURRENCY) break;
      if (item.state !== 'queued' || this.running.has(item.id)) continue;
      this.running.add(item.id);
      void this.run(item.id).finally(() => {
        this.running.delete(item.id);
        this.pump();
      });
    }
    this.updateSpeedTimer();
  }

  private stillWanted(id: number): boolean {
    const s = this.get(id)?.state;
    return s === 'uploading' || s === 'finishing';
  }

  private async run(id: number): Promise<void> {
    let item = this.get(id);
    if (!item) return;
    this.patch(id, { state: 'uploading', error: null });
    try {
      if (!item.sessionId) {
        const d = item.destination;
        const created = await this.trpc.upload.create.mutate({
          name: item.name,
          size: item.size,
          mime: item.type,
          albumId: d.kind === 'album' ? d.albumId : null,
          newAlbumName: d.kind === 'new' ? d.name : null,
          folder: d.kind === 'new' ? (d.folder ?? null) : null,
          meta: item.meta,
        });
        this.chunkBytes = created.chunkBytes || DEFAULT_CHUNK;
        this.patch(id, { sessionId: created.id, sent: 0 });
        // Cancelled while the session was being made.
        if (!this.stillWanted(id)) {
          if (this.get(id)?.state === 'cancelled') {
            this.trpc.upload.cancel.mutate({ id: created.id }).catch(() => {});
          }
          return;
        }
      }
      item = this.get(id)!;
      if (!item.file && item.open) {
        this.patch(id, { file: await item.open() });
        if (!this.stillWanted(id)) return;
        item = this.get(id)!;
      }
      const sessionId = item.sessionId!;
      const file = item.file!;
      let offset = item.sent;
      let failures = 0;

      while (offset < item.size) {
        if (!this.stillWanted(id)) return;
        const end = Math.min(offset + this.chunkBytes, item.size);
        try {
          const res = await this.putChunk(id, sessionId, offset, file.slice(offset, end));
          offset = res.received;
          failures = 0;
          this.patch(id, { sent: offset });
        } catch (e) {
          if (e instanceof Aborted) {
            // Paused or cancelled: the server keeps what it has; resume
            // starts again from the last confirmed offset.
            this.patch(id, { sent: offset });
            return;
          }
          if (e instanceof ChunkError && e.code === 'BAD_OFFSET' && e.received !== null) {
            offset = e.received;
            this.patch(id, { sent: offset });
            continue;
          }
          const retriable = e instanceof ChunkError && (e.status === 0 || e.status >= 500 || e.code === 'INTERRUPTED' || e.code === 'BUSY');
          if (retriable && failures < AUTO_RETRIES) {
            failures++;
            this.patch(id, { sent: offset });
            await new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * 2 ** (failures - 1))));
            continue;
          }
          throw e;
        }
      }

      if (!this.stillWanted(id)) return;
      this.patch(id, { state: 'finishing', sent: item.size });
      const fin = await this.trpc.upload.finish.mutate({ id: sessionId });
      if (this.get(id)?.state !== 'finishing') return;
      this.patch(id, { state: fin.status, albumId: fin.albumId });
      this.scheduleInvalidate();
    } catch (e) {
      if (!this.stillWanted(id)) return;
      this.patch(id, { state: 'error', error: errorMessage(e) });
      // The server dropped the session (refused type, cancelled, expired):
      // a retry starts over with a new one.
      if (e instanceof ChunkError && (e.status === 404 || e.status === 415 || e.code === 'CLOSED')) {
        this.patch(id, { sessionId: null, sent: 0 });
      }
    } finally {
      // A lazy item reopens its bytes on a retry; do not keep them meanwhile.
      if (this.get(id)?.open && this.get(id)?.file) this.patch(id, { file: null });
      this.maybeFinishBatch(item!.batch);
    }
  }

  private putChunk(id: number, sessionId: string, offset: number, blob: Blob): Promise<{ received: number }> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      this.xhrs.set(id, xhr);
      xhr.open('PUT', `${environment.api.url}/upload/${encodeURIComponent(sessionId)}?offset=${offset}`);
      xhr.withCredentials = true;
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.responseType = 'json';
      xhr.upload.onprogress = (e) => {
        if (this.get(id)?.state === 'uploading') this.patch(id, { sent: offset + e.loaded });
      };
      const done = () => this.xhrs.delete(id);
      xhr.onload = () => {
        done();
        const body = (xhr.response ?? {}) as { received?: number; error?: string; code?: string };
        if (xhr.status === 200 && typeof body.received === 'number') {
          resolve({ received: body.received });
        } else {
          reject(
            new ChunkError(
              body.error ?? `Upload failed (${xhr.status})`,
              xhr.status,
              body.code ?? null,
              typeof body.received === 'number' ? body.received : null,
            ),
          );
        }
      };
      xhr.onerror = () => {
        done();
        reject(new ChunkError('Connection lost', 0, null, null));
      };
      xhr.ontimeout = xhr.onerror;
      xhr.onabort = () => {
        done();
        reject(new Aborted());
      };
      xhr.send(blob);
    });
  }

  private maybeFinishBatch(batch: number): void {
    const rows = this.items().filter((i) => i.batch === batch);
    if (!rows.length || rows[0]!.quiet) return;
    const pending = rows.some((i) => i.state === 'queued' || i.state === 'uploading' || i.state === 'finishing' || i.state === 'paused');
    if (pending) return;
    // Report each batch once.
    if (this.reported.has(batch)) return;
    this.reported.add(batch);

    const done = rows.filter((i) => i.state === 'done');
    const dupes = rows.filter((i) => i.state === 'duplicate');
    const failed = rows.filter((i) => i.state === 'error');
    if (!done.length && !dupes.length && !failed.length) return;

    const parts: string[] = [];
    if (done.length) parts.push(`Uploaded ${plural.transform(done.length, 'file')}`);
    if (dupes.length) parts.push(`${plural.transform(dupes.length, 'file')} already in your library`);
    if (failed.length) parts.push(`${failed.length.toLocaleString()} failed`);
    const message = parts.join('. ') + '.';
    const albumId = done[0]?.albumId ?? dupes[0]?.albumId ?? null;
    const action = albumId
      ? { label: 'View album', run: () => void this.router.navigate(['/albums', albumId]) }
      : undefined;
    if (failed.length && !done.length) this.toast.error(message, { action });
    else this.toast.success(message, { action });
  }
  // New files show in the grid now (as placeholders until their thumbnails
  // are made; the websocket refreshes again when they are).
  private scheduleInvalidate(): void {
    if (this.invalidateTimer) return;
    this.invalidateTimer = setTimeout(() => {
      this.invalidateTimer = null;
      for (const key of [
        CacheKey.GalleryAll,
        CacheKey.GalleryPhotos,
        CacheKey.GalleryVideos,
        CacheKey.TimelineAll,
        CacheKey.TimelinePhotos,
        CacheKey.TimelineVideos,
        CacheKey.AlbumsAll,
        CacheKey.AlbumSingle,
        CacheKey.UploadConfig,
      ]) {
        this.queryClient.invalidateQueries({ queryKey: [key] });
      }
    }, 1500);
  }

  private updateSpeedTimer(): void {
    if (!this.isBrowser) return;
    const busy = this.items().some((i) => i.state === 'uploading');
    if (busy && !this.speedTimer) {
      this.lastSample = null;
      this.speedTimer = setInterval(() => this.sampleSpeed(), 1000);
    } else if (!busy && this.speedTimer && !this.isBusy()) {
      clearInterval(this.speedTimer);
      this.speedTimer = null;
      this.speed.set(0);
    }
  }

  private sampleSpeed(): void {
    const bytes = this.totals().sent;
    const now = Date.now();
    if (this.lastSample) {
      const dt = (now - this.lastSample.at) / 1000;
      const rate = Math.max(0, (bytes - this.lastSample.bytes) / dt);
      // Smooth so the number does not jump around.
      this.speed.set(this.speed() ? this.speed() * 0.7 + rate * 0.3 : rate);
    }
    this.lastSample = { at: now, bytes };
    if (!this.isBusy()) this.updateSpeedTimer();
  }
}
