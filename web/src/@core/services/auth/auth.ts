import { inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { injectBetterAuthClient } from '@core/services/auth/better-auth-client';

interface UserRecord {
  id: string;
  name: string;
  email: string;
  image?: string;
}
type User = UserRecord | null;

type SessionData = {
  session?: { token?: string; user?: UserRecord };
  user?: UserRecord;
} | null;

type SessionQueryState = {
  data: SessionData;
  isPending: boolean;
  isRefetching?: boolean;
  refetch?: () => Promise<unknown>;
} | null;

@Injectable({ providedIn: 'root' })
export class Auth {
  private readonly router = inject(Router);
  private readonly client = injectBetterAuthClient();

  private readonly _isAuthenticated = signal(false);
  private readonly _ready = signal(false);
  private readonly _session = signal<{ token?: string } | null>(null);
  private readonly _user = signal<User>(null);
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
  get session() {
    return this._session.asReadonly();
  }
  get user() {
    return this._user.asReadonly();
  }

  getSession() {
    // Exposed in case templates/components still use it.
    return this.client.getSession();
  }
  signInEmail(p: { email: string; password: string }) {
    return this.client.signIn.email(p).then((res) => {
      if (res.error) {
        return { error: res.error, data: null };
      }
      this._isAuthenticated.set(true);
      return { error: null, data: res.data };
    });
  }
  signUpEmail(p: { email: string; password: string; name: string }) {
    return this.client.signUp.email(p).then((res) => {
      if (res.error) {
        return { error: res.error, data: null };
      }
      this._isAuthenticated.set(true);
      return { error: null, data: res.data };
    });
  }
  async signOut() {
    this._isAuthenticated.set(false);
    this._session.set(null);
    this._user.set(null);
    this.client.signOut();
    await this.router.navigate(['/login']);
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
    if (shouldFetch)
      try {
        await s!.refetch?.();
      } catch {
        void 0;
      }
  }

  /** Update `_isAuthenticated` only when the store is settled. */
  private syncFromSessionStore() {
    const s = this.currentState();
    if (!s || s.isPending) return;
    const nextSession = s.data?.session ?? null;
    this._session.set(nextSession);
    const nextUser = s.data?.user ?? s.data?.session?.user ?? null;
    console.log(nextUser);
    this._user.set(nextUser);
    this._isAuthenticated.set(!!nextSession?.token);
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
