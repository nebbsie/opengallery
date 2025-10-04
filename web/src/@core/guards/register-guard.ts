import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { injectTrpc } from '@core/services/trpc';

export const RegisterGuard: CanActivateFn = async () => {
  const router = inject(Router);
  const trpc = injectTrpc();

  const isFirstUser = await trpc.users.isFirstSignup.query();
  const allowsSelfRegistration = await trpc.settings.allowsSelfRegistration.query();
  if (isFirstUser || allowsSelfRegistration) {
    return true;
  }

  return router.navigate(['/login'], { replaceUrl: true });
};
