import { Routes } from '@angular/router';
import { AuthGuard } from '@core/guards/auth-guard';
import { LoggedOutOnlyGuard } from '@core/guards/logged-out-only-guard';
import { LoginGuard } from '@core/guards/login-guard';
import { RegisterGuard } from '@core/guards/register-guard';

export const routes: Routes = [
  {
    path: 'login',
    title: 'Login - Open Gallery',
    canActivate: [LoggedOutOnlyGuard, LoginGuard],
    loadComponent: () => import('./login/login').then((c) => c.Login),
  },
  {
    path: 'register',
    title: 'Register - Open Gallery',
    canActivate: [LoggedOutOnlyGuard, RegisterGuard],
    loadComponent: () => import('./register/register').then((c) => c.Register),
  },
  {
    path: 'gallery',
    title: 'Gallery - Open Gallery',
    canActivate: [AuthGuard],
    loadChildren: () => import('./gallery/gallery.routes').then((r) => r.routes),
  },
  {
    path: 'albums',
    title: 'Albums - Open Gallery',
    canActivate: [AuthGuard],
    loadChildren: () => import('./album/album.routes').then((r) => r.routes),
  },
  {
    path: 'settings',
    title: 'Settings - Open Gallery',
    canActivate: [AuthGuard],
    loadChildren: () => import('./settings/settings.routes').then((r) => r.routes),
  },
  {
    path: 'asset/:id',
    title: 'Asset - Open Gallery',
    canActivate: [AuthGuard],
    loadChildren: () => import('./asset/asset.routes').then((r) => r.routes),
  },
  {
    path: '**',
    redirectTo: 'login',
    pathMatch: 'full',
  },
];
