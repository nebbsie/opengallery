import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./faces').then((c) => c.Faces),
    children: [
      {
        path: '',
        loadComponent: () => import('./faces-list/faces-list').then((c) => c.FacesList),
      },
      {
        path: ':id',
        loadComponent: () => import('./face-detail/face-detail').then((c) => c.FaceDetail),
      },
    ],
  },
];
