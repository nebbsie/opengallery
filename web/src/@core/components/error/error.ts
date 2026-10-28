import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronRight, lucideCircleAlert, lucideRefreshCw, lucideWifiOff } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { TRPCClientError } from '@trpc/client';

type ErrorKind = 'not_found' | 'unauthorized' | 'forbidden' | 'network' | 'server' | 'other';

const COPY: Record<ErrorKind, { title: string; body: string }> = {
  not_found: {
    title: 'This item was not found',
    body: 'It was moved or deleted, or the link is wrong.',
  },
  unauthorized: {
    title: 'Your session ended',
    body: 'Log in again to continue.',
  },
  forbidden: {
    title: 'You do not have access to this',
    body: 'Ask the owner to share it with you.',
  },
  network: {
    title: 'Could not reach the server',
    body: 'Check your connection, then try again.',
  },
  server: {
    title: 'The server had a problem',
    body: 'Try again in a moment. If it keeps happening, check the server logs.',
  },
  other: {
    title: 'Something went wrong',
    body: 'Try again. If it keeps happening, check the details below.',
  },
};

// Human error state for a failed query or mutation. Shows a plain message per
// tRPC code, a Retry button and, for a missing item, a link to Photos. The raw
// message and code stay behind a small "Details" disclosure.
//
// Retry calls the `retry` input when one is given. Without it, Retry refetches
// every query that is now in the error state, so existing callers get a working
// button without a change.
@Component({
  selector: 'app-error-alert',
  imports: [NgIcon, HlmIcon, HlmButton, RouterLink],
  providers: [provideIcons({ lucideCircleAlert, lucideRefreshCw, lucideWifiOff, lucideChevronRight })],
  host: { class: 'block' },
  template: `
    <div
      role="alert"
      class="bg-glass-tint text-card-foreground mx-auto my-6 flex max-w-md flex-col items-center gap-3 rounded-2xl border border-glass-border p-6 text-center"
    >
      <div class="bg-muted text-muted-foreground grid size-12 place-items-center rounded-full">
        <ng-icon hlm [name]="kind() === 'network' ? 'lucideWifiOff' : 'lucideCircleAlert'" />
      </div>
      <h2 class="text-base font-semibold text-balance">{{ copy().title }}</h2>
      <p class="text-muted-foreground text-sm text-pretty">{{ copy().body }}</p>

      <div class="mt-1 flex flex-wrap items-center justify-center gap-2">
        @if (kind() === 'unauthorized') {
          <a hlmBtn size="sm" routerLink="/login" class="transition-transform duration-100 active:scale-[0.96]">
            Log in
          </a>
        } @else if (showRetry()) {
          <button
            hlmBtn
            size="sm"
            type="button"
            class="transition-transform duration-100 active:scale-[0.96]"
            [disabled]="retrying()"
            (click)="onRetry()"
          >
            <ng-icon hlm size="sm" name="lucideRefreshCw" [class.animate-spin]="retrying()" />
            Retry
          </button>
        }
        @if (kind() === 'not_found' || kind() === 'forbidden') {
          <a
            hlmBtn
            size="sm"
            variant="outline"
            routerLink="/gallery"
            class="transition-transform duration-100 active:scale-[0.96]"
          >
            Go to Photos
          </a>
        }
      </div>

      @if (detail()) {
        <details class="group mt-2 w-full text-left">
          <summary
            class="text-muted-foreground hover:text-foreground flex cursor-pointer list-none items-center justify-center gap-1 text-xs select-none"
          >
            <ng-icon hlm size="xs" name="lucideChevronRight" class="transition-transform group-open:rotate-90" />
            Details
          </summary>
          <pre class="bg-muted text-muted-foreground mt-2 max-h-40 overflow-auto rounded-md p-2 text-xs break-all whitespace-pre-wrap">{{ detail() }}</pre>
        </details>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ErrorAlert {
  private readonly queryClient = inject(QueryClient);

  error = input<Error | null | undefined>();
  // Optional custom retry. Return a promise to show a busy state until it settles.
  retry = input<(() => unknown) | undefined>();
  // Set to false to hide Retry (for example, for a failed one-off mutation).
  retryable = input(true);

  protected readonly retrying = signal(false);

  private readonly code = computed<string | null>(() => {
    const err = this.error();
    if (err instanceof TRPCClientError) {
      const shapeCode = (err.shape as { code?: unknown } | undefined)?.code;
      if (typeof shapeCode === 'string') return shapeCode;
      const dataCode = (err.data as { code?: unknown } | undefined)?.code;
      if (typeof dataCode === 'string') return dataCode;
    }
    return null;
  });

  private readonly httpStatus = computed<number | null>(() => {
    const err = this.error() as { cause?: { status?: unknown }; status?: unknown } | null | undefined;
    const status = err?.cause?.status ?? err?.status;
    return typeof status === 'number' ? status : null;
  });

  protected readonly kind = computed<ErrorKind>(() => {
    const code = this.code();
    const status = this.httpStatus();
    if (code === 'NOT_FOUND' || status === 404) return 'not_found';
    if (code === 'UNAUTHORIZED' || status === 401) return 'unauthorized';
    if (code === 'FORBIDDEN' || status === 403) return 'forbidden';
    if (status === 0) return 'network';
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'network';
    const message = this.error()?.message ?? '';
    if (/failed to fetch|networkerror|network error/i.test(message)) return 'network';
    if (code === 'INTERNAL_SERVER_ERROR' || (status !== null && status >= 500)) return 'server';
    return 'other';
  });

  protected readonly copy = computed(() => COPY[this.kind()]);

  protected readonly showRetry = computed(() => this.retryable() && this.kind() !== 'not_found');

  protected readonly detail = computed(() => {
    const err = this.error();
    if (!err) return null;
    const parts = [
      this.code() ? `Code: ${this.code()}` : null,
      this.httpStatus() !== null ? `HTTP status: ${this.httpStatus()}` : null,
      err.message ? `Message: ${err.message}` : null,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join('\n') : null;
  });

  async onRetry(): Promise<void> {
    if (this.retrying()) return;
    this.retrying.set(true);
    try {
      const custom = this.retry();
      if (custom) {
        await custom();
      } else {
        await this.queryClient.refetchQueries({
          predicate: (query) => query.state.status === 'error',
        });
      }
    } catch {
      // The query shows its own error state again; nothing more to do here.
    } finally {
      this.retrying.set(false);
    }
  }
}
