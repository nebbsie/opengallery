import { Routes } from '@angular/router';
import { AdminGuard, SettingsHomeGuard } from '@core/guards/admin-guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./settings').then((c) => c.Settings),
    children: [
      {
        path: '',
        pathMatch: 'full',
        canActivate: [SettingsHomeGuard],
        children: [],
      },
      {
        path: 'sources',
        canActivate: [AdminGuard],
        loadComponent: () =>
          import('./settings-sources/settings-sources').then((c) => c.SettingsSources),
      },
      {
        path: 'logs',
        canActivate: [AdminGuard],
        loadComponent: () => import('./settings-logs/settings-logs').then((c) => c.SettingsLogs),
      },
      {
        path: 'users',
        canActivate: [AdminGuard],
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
        canActivate: [AdminGuard],
        loadComponent: () =>
          import('./settings-issues/settings-issues').then((c) => c.SettingsIssues),
      },
      {
        path: 'encoding',
        canActivate: [AdminGuard],
        loadComponent: () =>
          import('./settings-encoding/settings-encoding').then((c) => c.SettingsEncoding),
      },
      {
        path: 'faces',
        canActivate: [AdminGuard],
        loadComponent: () =>
          import('./settings-faces/settings-faces').then((c) => c.SettingsFaces),
      },
      {
        path: 'locations',
        canActivate: [AdminGuard],
        loadComponent: () =>
          import('./settings-locations/settings-locations').then((c) => c.SettingsLocations),
      },
      {
        path: 'tasks',
        canActivate: [AdminGuard],
        loadComponent: () => import('./settings-tasks/settings-tasks').then((c) => c.SettingsTasks),
      },
      {
        path: 'storage',
        canActivate: [AdminGuard],
        loadComponent: () =>
          import('./settings-storage/settings-storage').then((c) => c.SettingsStorage),
      },
      {
        path: 'duplicates',
        canActivate: [AdminGuard],
        loadComponent: () =>
          import('./settings-duplicates/settings-duplicates').then((c) => c.SettingsDuplicates),
      },
    ],
  },
];
