import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth } from '@core/services/auth/auth';

// Admin-only pages. A non-admin (and an admin in "View as") goes to the
// profile page, which every user can open.
export const AdminGuard: CanActivateFn = async () => {
  const auth = inject(Auth);
  const router = inject(Router);

  await auth.whenReady();

  if (auth.isAdmin()) {
    return true;
  }

  return router.createUrlTree(['/settings/profile']);
};

// The /settings index: admins land on source folders, everyone else on their
// profile. A guard (not redirectTo) so it can wait for the session to load.
export const SettingsHomeGuard: CanActivateFn = async () => {
  const auth = inject(Auth);
  const router = inject(Router);

  await auth.whenReady();

  return router.createUrlTree([auth.isAdmin() ? '/settings/sources' : '/settings/profile']);
};
