import { Injectable, signal } from '@angular/core';
import { injectBetterAuthClient } from '@core/services/auth/better-auth-client';

@Injectable({
  providedIn: 'root',
})
export class Auth {
  private client = injectBetterAuthClient();

  // Public signal for authentication status
  private readonly _isAuthenticated = signal<boolean>(false);

  constructor() {
    // Initialize from current session store synchronously
    this.syncFromSessionStore();

    // Subscribe to session store updates to keep signal in sync
    this.client.useSession.subscribe(() => {
      this.syncFromSessionStore();
    });
  }

  get isAuthenticated() {
    return this._isAuthenticated.asReadonly();
  }

  // Expose session getter (kept for template async usage)
  getSession() {
    return this.client.getSession();
  }

  // Sign in with email/password
  async signInEmail(params: { email: string; password: string }) {
    const result = await this.client.signIn.email(params);
    return result;
  }

  // Sign up with email/password
  async signUpEmail(params: { email: string; password: string; name: string }) {
    const result = await this.client.signUp.email(params);
    return result;
  }

  // Sign out
  async signOut() {
    const result = await this.client.signOut();
    return result;
  }

  async initialize() {
    await this.client.getSession();
    this.syncFromSessionStore();
  }

  private syncFromSessionStore() {
    const state = this.client.useSession.get() as {
      data: { session?: { token?: string } } | null;
      isPending: boolean;
    } | null;

    if (!state || state.isPending) return;

    const hasToken = Boolean(state?.data?.session?.token);
    this._isAuthenticated.set(hasToken);
  }
}
