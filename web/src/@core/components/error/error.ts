import { JsonPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleAlert } from '@ng-icons/lucide';
import { AppRouter } from '@opengallery/types';
import { HlmAlert, HlmAlertDescription, HlmAlertIcon, HlmAlertTitle } from '@spartan-ng/helm/alert';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { TRPCClientError } from '@trpc/client';

@Component({
  selector: 'app-error-alert',
  imports: [HlmAlert, NgIcon, HlmIcon, HlmAlertIcon, HlmAlertTitle, HlmAlertDescription, JsonPipe],
  providers: [provideIcons({ lucideCircleAlert })],

  template: `
    <div class="max-w-md" hlmAlert variant="destructive">
      <ng-icon hlm hlmAlertIcon name="lucideCircleAlert" />
      <h4 hlmAlertTitle>Oops there was an error.</h4>
      <p hlmAlertDesc>Message: {{ errorMessage() | json }}</p>
      <p hlmAlertDesc>Code: {{ errorCode() | json }}</p>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ErrorAlert {
  error = input<Error>();

  errorMessage = computed(() => {
    const err = this.error();

    if (this.isTRPCClientError(err)) {
      return err.shape?.message;
    }

    return 'It looks like something has gone wrong.';
  });

  errorCode = computed(() => {
    const err = this.error();

    if (this.isTRPCClientError(err)) {
      return err.shape?.code;
    }

    return 'UNKNOWN';
  });

  isTRPCClientError(cause: unknown): cause is TRPCClientError<AppRouter> {
    return cause instanceof TRPCClientError;
  }
}
