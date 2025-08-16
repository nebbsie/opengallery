import { Injectable, signal } from '@angular/core';
import { injectBetterAuthClient } from '@core/services/auth/better-auth-client';

type SessionQueryState = {
  data: { session?: { token?: string } } | null;
  isPending: boolean;
  isRefetching?: boolean;
  refetch?: () => Promise<unknown>;
} | null;

@Injectable({ providedIn: 'root' })
export class Auth {
  private readonly client = injectBetterAuthClient();

  private readonly _isAuthenticated = signal(false);
  private readonly _ready = signal(false);
  private _initPromise: Promise<void> | null = null;

  constructor() {
    // Keep our auth signal in sync with the session store.
    this.client.useSession.subscribe(() => this.syncFromSessionStore());
  }

  get isAuthenticated() {
    return this._isAuthenticated.asReadonly();
  }
  get ready() {
    return this._ready.asReadonly();
  }

  getSession() {
    // Exposed in case templates/components still use it.
    return this.client.getSession();
  }
  signInEmail(p: { email: string; password: string }) {
    return this.client.signIn.email(p);
  }
  signUpEmail(p: { email: string; password: string; name: string }) {
    return this.client.signUp.email(p);
  }
  signOut() {
    return this.client.signOut();
  }

  // --- lifecycle -------------------------------------------------------------
  /** Resolve once the first session state is settled (no pending/refetch). */
  async initialize(): Promise<void> {
    if (this._initPromise) return this._initPromise;

    this._initPromise = (async () => {
      await this.ensureSessionFetchStarted(); // kick off ONE fetch if needed
      await this.waitForSessionSettled(5000); // wait (with timeout)
      this.syncFromSessionStore(); // finalize current auth signal
      this._ready.set(true);
    })();

    return this._initPromise;
  }

  /** Convenience alias for guards/components. */
  whenReady(): Promise<void> {
    return this.initialize();
  }

  // --- internals -------------------------------------------------------------
  private currentState(): SessionQueryState {
    return this.client.useSession.get() as SessionQueryState;
  }

  /** If no data and nothing in flight, start a single fetch via the store. */
  private async ensureSessionFetchStarted() {
    const s = this.currentState();
    const shouldFetch = s && !s.isPending && !s.isRefetching && !s.data;
    if (shouldFetch) await s!.refetch?.().catch(() => {});
  }

  /** Update `_isAuthenticated` only when the store is settled. */
  private syncFromSessionStore() {
    const s = this.currentState();
    if (!s || s.isPending) return;
    this._isAuthenticated.set(!!s.data?.session?.token);
  }

  /** Wait until `useSession` is not pending/refetching (or timeout). */
  private waitForSessionSettled(timeoutMs = 5000): Promise<void> {
    return new Promise<void>((resolve) => {
      let unsubscribe: VoidFunction | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const done = () => {
        unsubscribe?.();
        if (timer) clearTimeout(timer);
        resolve();
      };

      const check = () => {
        const s = this.currentState();
        if (s && !s.isPending && !s.isRefetching) done();
      };

      unsubscribe = this.client.useSession.subscribe(check);
      timer = setTimeout(done, timeoutMs);
      check(); // handle already-settled state immediately
    });
  }
}
