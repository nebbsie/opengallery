import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./settings').then((c) => c.Settings),
    children: [
      {
        path: 'library',
        loadComponent: () =>
          import('./settings-library/settings-library').then((c) => c.SettingsLibrary),
      },
    ],


  },
];
