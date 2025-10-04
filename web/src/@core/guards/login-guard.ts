import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { injectTrpc } from '@core/services/trpc';

export const LoginGuard: CanActivateFn = async () => {
  const router = inject(Router);
  const trpc = injectTrpc();

  const isFirstUser = await trpc.users.isFirstSignup.query();
  if (isFirstUser) {
    return router.navigate(['/register']);
  }

  return true;
};
