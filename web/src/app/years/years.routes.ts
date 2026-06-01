import { Routes } from '@angular/router';
import { prefetchYearsAll } from '../prefetch-guards';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./years').then((c) => c.Years),
    children: [
      {
        path: '',
        canActivate: [prefetchYearsAll],
        loadComponent: () => import('./years-all/years-all').then((c) => c.YearsAll),
      },
      {
        path: ':year',
        loadComponent: () => import('./years-detail/years-detail').then((c) => c.YearsDetail),
      },
    ],
  },
];
