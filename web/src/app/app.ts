import { Component, inject } from '@angular/core';
import { injectAuthClient } from '@core/services/auth/auth-client';
import { Health } from '@core/services/health/health';
import { AsyncPipe, JsonPipe } from '@angular/common';

@Component({
  selector: 'app-root',
  template: `
    <div>
      <button (click)="handleSignIn()">Sign In</button>
      <button (click)="handleSignUp()">Sign Up</button>
      <button (click)="handleSignOut()">Sign Out</button>
    </div>

    <code>{{ session | async | json }}</code>
  `,
  imports: [JsonPipe, AsyncPipe],
})
export class App {
  private readonly auth = injectAuthClient();
  private readonly health = inject(Health);

  session = this.auth.getSession();

  healthCheck = this.health.get();

  async handleSignIn() {
    const { data, error } = await this.auth.signIn.email({
      email: 'nebbsie@gmail.com',
      password: 'password',
    });

    if (error) {
      console.error('Sign in failed:', error);
      return;
    }

    console.log('Sign in successful:', data);
  }

  async handleSignOut() {
    const { error } = await this.auth.signOut();
    if (error) {
      console.error('Sign out failed:', error);
      return;
    }
  }

  async handleSignUp() {
    const { data, error } = await this.auth.signUp.email({
      email: 'nebbsie@gmail.com',
      password: 'password',
      name: 'nebbsie',
    });

    if (error) {
      console.error('Sign up failed:', error);
      return;
    }

    console.log('Sign up successful:', data);
  }
}
