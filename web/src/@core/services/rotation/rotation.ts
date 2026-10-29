import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { injectTrpc } from '@core/services/trpc';
import { environment } from '@env/environment';
import { QueryClient } from '@tanstack/angular-query-experimental';

const POLL_MS = 2000;

type Pending = {
  // Rotation of the variants the browser already has (shown until the new
  // ones are encoded).
  from: number;
  // Clockwise CSS turn on top of them, so the photo looks turned at once.
  turn: number;
};

/**
 * Photo rotation (edit.rotateFiles). The worker encodes the variants again,
 * which takes a few seconds; meanwhile the old variant is shown turned by CSS.
 * Variant URLs carry ?r=<rotation> so a turned photo never reuses a cached
 * image of another rotation (the asset route caches variants for a year).
 */
@Injectable({ providedIn: 'root' })
export class RotationService {
  private readonly trpc = injectTrpc();
  private readonly queryClient = inject(QueryClient);
  private readonly apiUrl = environment.api.url;

  private readonly pending = signal<ReadonlyMap<string, Pending>>(new Map());
  // Rotation of photos turned in this tab, used for the URL until the lists
  // and the viewer refetch with it (no flash of the old variant meanwhile).
  private readonly settled = signal<ReadonlyMap<string, number>>(new Map());
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  /** Clockwise CSS turn to show on top of the variant, 0 when none. */
  turn(id: string): number {
    return this.pending().get(id)?.turn ?? 0;
  }

  /** URL of a variant (thumbnail, thumbnail_lg, optimised) for this rotation. */
  variantUrl(id: string, variant: string, rotation: number | null | undefined): string {
    const p = this.pending().get(id);
    const r = p ? p.from : (this.settled().get(id) ?? rotation ?? 0);
    return `${this.apiUrl}/asset/${id}/${variant}${r ? `?r=${r}` : ''}`;
  }

  /** Turn photos; resolves with the server's answer (failed files, if any). */
  async rotate(fileIds: string[], degrees: 90 | -90 | 180) {
    const res = await this.trpc.edit.rotateFiles.mutate({ fileIds, degrees });
    this.pending.update((old) => {
      const next = new Map(old);
      for (const f of res.files) {
        const prev = next.get(f.id);
        next.set(f.id, {
          from: prev ? prev.from : (((f.rotation - degrees) % 360) + 360) % 360,
          turn: (prev?.turn ?? 0) + degrees,
        });
      }
      return next;
    });
    if (res.files.length) this.start();
    return res;
  }

  private start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.poll(), POLL_MS);
  }

  private stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // Ask which photos still wait for their new variants; the rest show the new
  // pixels (their URLs change to the new ?r=, so the browser fetches them).
  private async poll(): Promise<void> {
    const ids = [...this.pending().keys()];
    if (!ids.length) return this.stop();
    let waiting: string[];
    try {
      waiting = await this.trpc.edit.rotationPending.query({ fileIds: ids.slice(0, 5000) });
    } catch {
      return; // Try again on the next tick.
    }
    const still = new Set(waiting);
    const finished = ids.filter((id) => !still.has(id));
    if (!finished.length) return;
    const done = new Map(this.settled());
    for (const id of finished) {
      const p = this.pending().get(id)!;
      done.set(id, (((p.from + p.turn) % 360) + 360) % 360);
    }
    this.settled.set(done);
    this.pending.update((old) => {
      const next = new Map(old);
      for (const id of finished) next.delete(id);
      return next;
    });
    // New sizes, faces and the new rotation for the lists and the viewer.
    void this.queryClient.invalidateQueries();
    if (!this.pending().size) this.stop();
  }
}
