import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./settings').then((c) => c.Settings),
    children: [
      {
        path: '',
        redirectTo: 'sources',
        pathMatch: 'full',
      },
      {
        path: 'sources',
        loadComponent: () =>
          import('./settings-sources/settings-sources').then((c) => c.SettingsSources),
      },
    ],
  },
];
