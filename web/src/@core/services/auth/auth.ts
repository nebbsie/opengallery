import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { injectBetterAuthClient } from '@core/services/auth/better-auth-client';
import { QueryClient } from '@tanstack/angular-query-experimental';

interface UserRecord {
  id: string;
  name: string;
  email: string;
  type: 'user' | 'admin';
  image?: string;
}
type User = UserRecord | null;

type SessionData = {
  session?: { token?: string; user?: UserRecord };
  user?: UserRecord;
} | null;

// "View as" preview. The API honours this cookie only for an admin session and
// then answers every request as the named user, read-only (see
// api/src/auth/view-as.ts). The name is kept next to it for the banner.
const VIEW_AS_COOKIE = 'og_view_as';
const VIEW_AS_NAME_KEY = 'og_view_as_name';

export type ViewAs = { userId: string; name: string };

function readViewAsCookie(): string | null {
  if (typeof document === 'undefined') return null;
  for (const part of document.cookie.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === VIEW_AS_COOKIE) return decodeURIComponent(v.join('=')) || null;
  }
  return null;
}

function writeViewAsCookie(userId: string | null): void {
  if (typeof document === 'undefined') return;
  document.cookie = userId
    ? `${VIEW_AS_COOKIE}=${encodeURIComponent(userId)}; path=/; SameSite=Lax`
    : `${VIEW_AS_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}

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
  private readonly queryClient = inject(QueryClient);

  private readonly _isAuthenticated = signal(false);
  private readonly _ready = signal(false);
  private readonly _session = signal<{ token?: string } | null>(null);
  private readonly _user = signal<User>(null);
  private readonly _viewAs = signal<ViewAs | null>(null);
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
  /** The user being previewed with "View as", or null. */
  get viewAs() {
    return this._viewAs.asReadonly();
  }

  /** True for a signed-in admin (also while previewing another user). */
  readonly isRealAdmin = computed(() => this._user()?.type === 'admin');

  /**
   * Show admin UI only to an admin who is not previewing another user. Use this
   * (not user().type) for every admin-only control, so the preview shows the
   * app exactly as the other user sees it.
   */
  readonly isAdmin = computed(() => this.isRealAdmin() && !this._viewAs());

  /** Start a read-only preview as another user. Reloads the app. */
  startViewAs(user: ViewAs): void {
    writeViewAsCookie(user.userId);
    try {
      localStorage.setItem(VIEW_AS_NAME_KEY, user.name);
    } catch {
      void 0;
    }
    window.location.assign('/gallery');
  }

  /** End the preview and go back to the users page. Reloads the app. */
  stopViewAs(returnUrl = '/settings/users'): void {
    writeViewAsCookie(null);
    try {
      localStorage.removeItem(VIEW_AS_NAME_KEY);
    } catch {
      void 0;
    }
    window.location.assign(returnUrl);
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
    writeViewAsCookie(null);
    this._viewAs.set(null);
    this._isAuthenticated.set(false);
    this._session.set(null);
    this._user.set(null);
    try {
      await this.client.signOut();
    } catch {
      void 0;
    }
    // Drop the previous user's cached queries; most lists use a multi-minute
    // staleTime, so the next user to sign in on this tab would otherwise see them.
    this.queryClient.clear();
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
    this._user.set(nextUser);
    this._isAuthenticated.set(!!nextSession?.token);
    this.syncViewAs(nextUser);
  }

  /** The preview applies only to a signed-in admin; drop a stale cookie. */
  private syncViewAs(user: User) {
    const userId = readViewAsCookie();
    if (!userId) {
      this._viewAs.set(null);
      return;
    }
    if (user?.type !== 'admin' || userId === user.id) {
      if (user) writeViewAsCookie(null);
      this._viewAs.set(null);
      return;
    }
    let name = '';
    try {
      name = localStorage.getItem(VIEW_AS_NAME_KEY) ?? '';
    } catch {
      void 0;
    }
    this._viewAs.set({ userId, name: name || 'another user' });
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
