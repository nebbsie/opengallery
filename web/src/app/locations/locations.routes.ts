import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: ':lat/:lon',
    loadComponent: () => import('./location-detail/location-detail').then((c) => c.LocationDetail),
  },
];
