import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./folder').then((c) => c.Folder),
    children: [
      {
        path: 'all',
        pathMatch: 'full',
        redirectTo: '',
      },
      {
        path: '',
        loadComponent: () => import('./folder-all/folder-all').then((c) => c.FolderAll),
      },
      {
        path: ':id',
        loadComponent: () => import('./folder-detail/folder-detail').then((c) => c.FolderDetail),
      },
    ],
  },
];
