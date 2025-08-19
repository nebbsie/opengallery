import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./gallery').then((c) => c.Gallery),
    children: [
      {
        path: 'all',
        pathMatch: 'full',
        redirectTo: '',
      },
      {
        path: '',
        loadComponent: () => import('./gallery-all/gallery-all').then((c) => c.GalleryAll),
      },
      {
        path: 'photos',
        loadComponent: () => import('./gallery-photos/gallery-photos').then((c) => c.GalleryPhotos),
      },
      {
        path: 'videos',
        loadComponent: () => import('./gallery-videos/gallery-videos').then((c) => c.GalleryVideos),
      },
    ],
  },
];
