import { Routes } from '@angular/router';
import { prefetchGalleryAll, prefetchGalleryPhotos, prefetchGalleryVideos } from '../prefetch-guards';

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
        canActivate: [prefetchGalleryAll],
        loadComponent: () => import('./gallery-all/gallery-all').then((c) => c.GalleryAll),
      },
      {
        path: 'photos',
        canActivate: [prefetchGalleryPhotos],
        loadComponent: () => import('./gallery-photos/gallery-photos').then((c) => c.GalleryPhotos),
      },
      {
        path: 'videos',
        canActivate: [prefetchGalleryVideos],
        loadComponent: () => import('./gallery-videos/gallery-videos').then((c) => c.GalleryVideos),
      },
    ],
  },
];
