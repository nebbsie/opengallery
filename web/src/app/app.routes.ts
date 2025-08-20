import { Routes } from '@angular/router';
import { AuthGuard } from '@core/guards/auth-guard';
import { LoggedOutOnlyGuard } from '@core/guards/logged-out-only-guard';

export const routes: Routes = [
  {
    path: 'login',
    title: 'Login - Open Gallery',
    canActivate: [LoggedOutOnlyGuard],
    loadComponent: () => import('./login/login').then((c) => c.Login),
  },
  {
    path: 'register',
    title: 'Register - Open Gallery',
    canActivate: [LoggedOutOnlyGuard],
    loadComponent: () => import('./register/register').then((c) => c.Register),
  },
  {
    path: 'gallery',
    title: 'Gallery - Open Gallery',
    canActivate: [AuthGuard],
    loadChildren: () => import('./gallery/gallery.routes').then((r) => r.routes),
  },
  {
    path: 'settings',
    title: 'Settings - Open Gallery',
    canActivate: [AuthGuard],
    loadChildren: () => import('./settings/settings.routes').then((r) => r.routes),
  },
  {
    path: 'setup',
    title: 'Setup - Library Management',
    canActivate: [AuthGuard],
    loadComponent: () => import('./setup/setup').then((m) => m.Setup),
  },
  {
    path: '**',
    redirectTo: 'login',
    pathMatch: 'full',
  },
];
