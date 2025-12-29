import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./cameras').then((c) => c.Cameras),
    children: [
      {
        path: '',
        loadComponent: () => import('./cameras-list/cameras-list').then((c) => c.CamerasList),
      },
      {
        path: ':make/:model',
        loadComponent: () => import('./camera-detail/camera-detail').then((c) => c.CameraDetail),
      },
    ],
  },
];
