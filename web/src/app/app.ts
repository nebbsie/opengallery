import { Component, inject } from '@angular/core';
import { Auth } from '@core/services/auth/auth';

@Component({
  selector: 'app-root',
  template: `
    <div>
      <button (click)="handleSignIn()">Sign In</button>
      <button (click)="handleSignUp()">Sign Up</button>
      <button (click)="handleSignOut()">Sign Out</button>
    </div>

    <code>{{ authenticated() }}</code>
  `,
  imports: [],
})
export class App {
  private readonly auth = inject(Auth);

  authenticated = this.auth.isAuthenticated;

  async handleSignIn() {
    const { data, error } = await this.auth.signInEmail({
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
    const { data, error } = await this.auth.signUpEmail({
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
