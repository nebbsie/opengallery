import { Routes } from '@angular/router';
import { AuthGuard } from '@core/guards/auth-guard';
import { LoggedOutOnlyGuard } from '@core/guards/logged-out-only-guard';

export const routes: Routes = [
  {
    path: 'login',
    title: 'Login - Open Gallery',
    canActivate: [LoggedOutOnlyGuard],
    loadComponent: () => import('./login/login').then((m) => m.Login),
  },
  {
    path: 'register',
    title: 'Register - Open Gallery',
    canActivate: [LoggedOutOnlyGuard],
    loadComponent: () => import('./register/register').then((m) => m.Register),
  },
  {
    path: 'gallery',
    title: 'Gallery - Open Gallery',
    canActivate: [AuthGuard],
    loadComponent: () => import('./gallery/gallery').then((m) => m.Gallery),
  },
  {
    path: 'settings',
    title: 'Settings - Open Gallery',
    canActivate: [AuthGuard],
    loadComponent: () => import('./settings/settings').then((m) => m.Settings),
  },
  {
    path: '**',
    redirectTo: 'login',
    pathMatch: 'full',
  },
];
