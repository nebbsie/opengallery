import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { injectTrpc } from '@core/services/trpc';
import { UploadService, type UploadMeta } from '@core/services/upload/upload';
import { buildPlan, extOf, parseSidecar, type PlanItem, type TakeoutPlan } from './takeout-plan';
import { closeZips, entryBlob, entryText, openZips, type OpenZip } from './takeout-zip';

// Runs a Google Takeout import in the browser (route /import/takeout). A root
// service, so the import keeps going while the user uses the rest of the app;
// it stops if the tab closes, and picking the same zips again skips what is
// done (remembered per zip in localStorage).
//
// The plan can hold tens of thousands of files. They are fed to UploadService
// a few at a time (WINDOW) and removed from it when they end, so the upload
// panel and its signals stay small.

const FOLDER = 'Google Photos';
const WINDOW = 6;
const STORE_PREFIX = 'og.takeout.v1.';

const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  '3gp': 'video/3gpp',
  mts: 'video/mp2t',
  m2ts: 'video/mp2t',
};

export type ImportPhase = 'idle' | 'reading' | 'ready' | 'running' | 'paused' | 'done';

export interface ImportFailure {
  index: number;
  name: string;
  folder: string;
  error: string;
}

@Injectable({ providedIn: 'root' })
export class TakeoutImport {
  private readonly trpc = injectTrpc();
  private readonly uploads = inject(UploadService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly phase = signal<ImportPhase>('idle');
  readonly error = signal<string | null>(null);
  readonly zipsRead = signal(0);
  readonly zipCount = signal(0);
  readonly plan = signal<TakeoutPlan | null>(null);
  // Plan indexes finished in an earlier run (same zips picked again).
  readonly alreadyDone = signal(0);
  readonly uploaded = signal(0);
  readonly duplicates = signal(0);
  readonly failures = signal<readonly ImportFailure[]>([]);
  private readonly finishedBytes = signal(0);

  private zips: OpenZip[] = [];
  private done = new Set<number>();
  // Per zip: the entry paths that are done, as stored.
  private stored: Set<string>[] = [];
  private storeKeys: string[] = [];
  private storeTimer: ReturnType<typeof setTimeout> | null = null;
  private queue: number[] = [];
  // UploadService item id -> plan index.
  private readonly inFlight = new Map<number, number>();
  private readonly running = signal(0);
  private tick: ReturnType<typeof setInterval> | null = null;
  private wakeLock: { release(): Promise<void> } | null = null;
  private maxBytes = Infinity;

  readonly current = computed(() => {
    this.running();
    const ids = new Set(this.inFlight.keys());
    return this.uploads.items().filter((i) => ids.has(i.id) && i.state !== 'queued');
  });

  readonly progress = computed(() => {
    const plan = this.plan();
    let inFlight = 0;
    for (const i of this.current()) inFlight += i.sent;
    return {
      total: plan?.totalBytes ?? 0,
      sent: this.finishedBytes() + inFlight,
      files: plan?.items.length ?? 0,
      finished: this.alreadyDone() + this.uploaded() + this.duplicates(),
    };
  });

  readonly speed = this.uploads.speed;

  // ---------- reading ----------

  async pick(files: readonly File[]): Promise<void> {
    if (this.phase() === 'running' || this.phase() === 'paused') return;
    await this.reset();
    const zips = files.filter((f) => f.name.toLowerCase().endsWith('.zip'));
    if (!zips.length) {
      this.error.set('Pick the .zip files from Google Takeout.');
      return;
    }
    this.phase.set('reading');
    this.zipCount.set(zips.length);
    try {
      const { zips: open, entries } = await openZips(zips, (n) => this.zipsRead.set(n));
      this.zips = open;
      const plan = buildPlan(entries);
      if (!plan.items.length) {
        this.error.set('No Google Photos files found in these zips. Export Google Photos in Google Takeout.');
        this.phase.set('idle');
        return;
      }
      this.storeKeys = zips.map((z) => `${STORE_PREFIX}${z.name}|${z.size}`);
      this.stored = this.storeKeys.map((k) => new Set(readStore(k)));
      plan.items.forEach((it, i) => {
        if (this.stored[it.entry.zip]?.has(it.entry.path)) this.done.add(i);
      });
      this.alreadyDone.set(this.done.size);
      this.plan.set(plan);
      this.phase.set('ready');
    } catch (e) {
      this.error.set(`Could not read the zips: ${(e as Error)?.message ?? e}`);
      this.phase.set('idle');
    }
  }

  // ---------- running ----------

  async start(): Promise<void> {
    const plan = this.plan();
    if (!plan || (this.phase() !== 'ready' && this.phase() !== 'done')) return;
    try {
      const cfg = await this.trpc.upload.config.query();
      if (!cfg.enabled) {
        this.error.set('Uploads are off. An admin must set an uploads location in Settings, Storage.');
        return;
      }
      this.maxBytes = cfg.maxBytes;
    } catch {
      this.error.set('Could not start the import. Try again.');
      return;
    }
    this.error.set(null);
    this.queue = plan.items.map((_, i) => i).filter((i) => !this.done.has(i));
    this.failures.set([]);
    this.phase.set('running');
    void this.holdWakeLock();
    this.tick ??= setInterval(() => this.step(), 400);
    this.step();
  }

  pause(): void {
    if (this.phase() !== 'running') return;
    this.phase.set('paused');
    for (const id of this.inFlight.keys()) this.uploads.pause(id);
    void this.releaseWakeLock();
  }

  resume(): void {
    if (this.phase() !== 'paused') return;
    this.phase.set('running');
    for (const id of this.inFlight.keys()) this.uploads.resume(id);
    void this.holdWakeLock();
    this.step();
  }

  // Stop; what is done stays done, and Start continues with the rest.
  cancel(): void {
    for (const id of this.inFlight.keys()) this.uploads.cancel(id);
    this.uploads.remove([...this.inFlight.keys()]);
    this.inFlight.clear();
    this.running.update((n) => n + 1);
    this.stopTicking();
    this.flushStore();
    this.phase.set('ready');
  }

  retryFailed(): void {
    const failed = this.failures().map((f) => f.index);
    if (!failed.length) return;
    this.failures.set([]);
    this.queue.unshift(...failed);
    if (this.phase() === 'done' || this.phase() === 'ready') {
      this.phase.set('running');
      void this.holdWakeLock();
      this.tick ??= setInterval(() => this.step(), 400);
    }
    this.step();
  }

  // Follow the items in UploadService, record the ones that ended, and feed
  // more while there is room.
  private step(): void {
    const plan = this.plan();
    if (!plan) return;
    const ended: number[] = [];
    for (const item of this.uploads.items()) {
      const index = this.inFlight.get(item.id);
      if (index === undefined) continue;
      const it = plan.items[index]!;
      if (item.state === 'done' || item.state === 'duplicate') {
        (item.state === 'done' ? this.uploaded : this.duplicates).update((n) => n + 1);
        this.finishedBytes.update((n) => n + it.entry.size);
        this.markDone(index, it);
      } else if (item.state === 'error' || item.state === 'cancelled') {
        if (item.state === 'error') this.fail(index, it, item.error ?? 'Upload failed');
      } else {
        continue;
      }
      ended.push(item.id);
      this.inFlight.delete(item.id);
    }
    if (ended.length) {
      this.uploads.remove(ended);
      this.running.update((n) => n + 1);
    }
    if (this.phase() === 'running') {
      while (this.inFlight.size + this.opening < WINDOW && this.queue.length) {
        void this.feed(this.queue.shift()!);
      }
      if (!this.queue.length && !this.inFlight.size && !this.opening) this.finish();
    }
  }

  private opening = 0;

  private async feed(index: number): Promise<void> {
    const it = this.plan()!.items[index]!;
    if (it.entry.size > this.maxBytes) {
      this.fail(index, it, 'Larger than the upload limit');
      return;
    }
    this.opening++;
    try {
      const meta = await this.metaFor(it);
      if (this.phase() === 'idle') return;
      const type = MIME[extOf(it.name)] ?? 'application/octet-stream';
      const [id] = this.uploads.enqueueLazy([
        {
          name: it.name,
          size: it.entry.size,
          type,
          open: () => entryBlob(this.zips, it.entry, type),
          destination: { kind: 'new', name: it.target, folder: FOLDER },
          meta,
        },
      ]);
      if (id !== undefined) this.inFlight.set(id, index);
      this.running.update((n) => n + 1);
      if (this.phase() === 'paused' && id !== undefined) this.uploads.pause(id);
    } catch (e) {
      this.fail(index, it, (e as Error)?.message ?? 'Could not read the file from the zip');
    } finally {
      this.opening--;
    }
  }

  private async metaFor(it: PlanItem): Promise<UploadMeta | null> {
    if (!it.json) return null;
    try {
      const m = parseSidecar(await entryText(this.zips, it.json));
      return { source: 'google-takeout', ...m };
    } catch {
      return null;
    }
  }

  private fail(index: number, it: PlanItem, error: string): void {
    this.failures.update((list) => [...list, { index, name: it.name, folder: it.source, error }]);
  }

  private finish(): void {
    this.stopTicking();
    this.flushStore();
    void this.releaseWakeLock();
    this.phase.set('done');
  }

  private stopTicking(): void {
    if (this.tick) clearInterval(this.tick);
    this.tick = null;
  }

  async reset(): Promise<void> {
    if (this.inFlight.size) this.cancel();
    this.stopTicking();
    this.flushStore();
    await closeZips(this.zips);
    this.zips = [];
    this.done = new Set();
    this.stored = [];
    this.storeKeys = [];
    this.queue = [];
    this.plan.set(null);
    this.error.set(null);
    this.zipsRead.set(0);
    this.zipCount.set(0);
    this.alreadyDone.set(0);
    this.uploaded.set(0);
    this.duplicates.set(0);
    this.finishedBytes.set(0);
    this.failures.set([]);
    this.phase.set('idle');
  }

  // ---------- resume store ----------

  private markDone(index: number, it: PlanItem): void {
    this.done.add(index);
    this.stored[it.entry.zip]?.add(it.entry.path);
    this.storeTimer ??= setTimeout(() => this.flushStore(), 5000);
  }

  private flushStore(): void {
    if (this.storeTimer) clearTimeout(this.storeTimer);
    this.storeTimer = null;
    this.storeKeys.forEach((key, i) => {
      try {
        localStorage.setItem(key, JSON.stringify([...(this.stored[i] ?? [])]));
      } catch {
        // Storage full or blocked: a re-run then re-sends these, and the
        // server reports them as duplicates.
      }
    });
  }

  // ---------- keep the screen on ----------

  private async holdWakeLock(): Promise<void> {
    if (!this.isBrowser || this.wakeLock) return;
    try {
      const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } };
      this.wakeLock = (await nav.wakeLock?.request('screen')) ?? null;
      document.addEventListener('visibilitychange', this.relock);
    } catch {
      this.wakeLock = null;
    }
  }

  // The browser drops the lock when the tab is hidden; take it again.
  private readonly relock = () => {
    if (document.visibilityState === 'visible' && this.phase() === 'running') {
      this.wakeLock = null;
      void this.holdWakeLock();
    }
  };

  private async releaseWakeLock(): Promise<void> {
    if (!this.isBrowser) return;
    document.removeEventListener('visibilitychange', this.relock);
    try {
      await this.wakeLock?.release();
    } catch {
      // Already released.
    }
    this.wakeLock = null;
  }
}

function readStore(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}
