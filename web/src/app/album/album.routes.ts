import { Routes } from '@angular/router';
import { prefetchAlbumsAll } from '../prefetch-guards';

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
        canActivate: [prefetchAlbumsAll],
        loadComponent: () => import('./album-all/album-all').then((c) => c.AlbumAll),
      },
      {
        path: ':id',
        loadComponent: () => import('./album-detail/album-detail').then((c) => c.AlbumDetail),
      },
    ],
  },
];
