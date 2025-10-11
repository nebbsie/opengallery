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
      {
        path: 'logs',
        loadComponent: () => import('./settings-logs/settings-logs').then((c) => c.SettingsLogs),
      },
      {
        path: 'users',
        loadComponent: () => import('./settings-users/settings-users').then((c) => c.SettingsUsers),
      },
      {
        path: 'ui',
        loadComponent: () => import('./settings-ui/settings-ui').then((c) => c.SettingsUi),
      },
      {
        path: 'issues',
        loadComponent: () =>
          import('./settings-issues/settings-issues').then((c) => c.SettingsIssues),
      },
      {
        path: 'encoding',
        loadComponent: () =>
          import('./settings-encoding/settings-encoding').then((c) => c.SettingsEncoding),
      },
    ],
  },
];
