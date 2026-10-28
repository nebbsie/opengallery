import { Injectable, signal } from '@angular/core';

export type ToastKind = 'default' | 'success' | 'error';

export interface ToastAction {
  label: string;
  run: () => void | Promise<void>;
}

export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
  action?: ToastAction;
}

export interface ToastOptions {
  kind?: ToastKind;
  action?: ToastAction;
  // Milliseconds before the toast closes on its own. Toasts with an action
  // (e.g. Undo) stay longer so there is time to use it.
  duration?: number;
}

// App-wide toast queue. Render with <app-toaster /> once (in the app shell).
@Injectable({ providedIn: 'root' })
export class ToastService {
  private nextId = 1;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  readonly toasts = signal<Toast[]>([]);

  show(message: string, opts: ToastOptions = {}): number {
    const id = this.nextId++;
    const toast: Toast = { id, message, kind: opts.kind ?? 'default', action: opts.action };
    // Keep at most 3 on screen; the oldest goes first.
    this.toasts.update((list) => [...list.slice(-2), toast]);
    const duration = opts.duration ?? (opts.action ? 8000 : 4000);
    if (typeof window !== 'undefined') {
      this.timers.set(id, setTimeout(() => this.dismiss(id), duration));
    }
    return id;
  }

  success(message: string, opts: Omit<ToastOptions, 'kind'> = {}): number {
    return this.show(message, { ...opts, kind: 'success' });
  }

  error(message: string, opts: Omit<ToastOptions, 'kind'> = {}): number {
    return this.show(message, { ...opts, kind: 'error' });
  }

  dismiss(id: number): void {
    const t = this.timers.get(id);
    if (t) clearTimeout(t);
    this.timers.delete(id);
    this.toasts.update((list) => list.filter((x) => x.id !== id));
  }

  async runAction(toast: Toast): Promise<void> {
    this.dismiss(toast.id);
    try {
      await toast.action?.run();
    } catch {
      this.error('That did not work. Try again.');
    }
  }
}
