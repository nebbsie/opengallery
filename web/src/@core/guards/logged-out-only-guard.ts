import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth } from '@core/services/auth/auth';

export const LoggedOutOnlyGuard: CanActivateFn = async () => {
  const auth = inject(Auth);
  const router = inject(Router);

  await auth.whenReady();

  if (auth.isAuthenticated()) {
    return router.createUrlTree(['/gallery']);
  }

  return true;
};
