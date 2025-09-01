import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./album').then((c) => c.Album),
    children: [
      {
        path: 'all',
        pathMatch: 'full',
        redirectTo: '',
      },
      {
        path: '',
        loadComponent: () => import('./album-all/album-all').then((c) => c.AlbumAll),
      },
      {
        path: ':id',
        loadComponent: () => import('./album-detail/album-detail').then((c) => c.AlbumDetail),
      },
    ],
  },
];
