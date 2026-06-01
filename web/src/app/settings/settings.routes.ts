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
        path: 'profile',
        loadComponent: () =>
          import('./settings-profile/settings-profile').then((c) => c.SettingsProfile),
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
      {
        path: 'faces',
        loadComponent: () =>
          import('./settings-faces/settings-faces').then((c) => c.SettingsFaces),
      },
      {
        path: 'locations',
        loadComponent: () =>
          import('./settings-locations/settings-locations').then((c) => c.SettingsLocations),
      },
      {
        path: 'tasks',
        loadComponent: () => import('./settings-tasks/settings-tasks').then((c) => c.SettingsTasks),
      },
      {
        path: 'storage',
        loadComponent: () =>
          import('./settings-storage/settings-storage').then((c) => c.SettingsStorage),
      },
      {
        path: 'duplicates',
        loadComponent: () =>
          import('./settings-duplicates/settings-duplicates').then((c) => c.SettingsDuplicates),
      },
    ],
  },
];
