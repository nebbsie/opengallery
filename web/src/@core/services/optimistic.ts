import { QueryClient } from '@tanstack/angular-query-experimental';

// Helpers for optimistic mutations: update the cache immediately so the UI feels
// instant, then roll back if the server rejects. Standard usage:
//
//   thing = injectMutation(() => ({
//     mutationFn: (vars) => trpc...mutate(vars),
//     onMutate: (vars) => optimisticEdit(qc, [
//       { queryKey: [CacheKey.X], update: (old) => ... },
//     ]),
//     onError: (_e, _vars, ctx) => ctx?.rollback(),
//     onSettled: () => qc.invalidateQueries({ queryKey: [CacheKey.X] }),
//   }));
//
// The onSettled refetch reconciles with server truth in the background; because
// the optimistic value already matches, TanStack keeps showing it until the
// refetch resolves, so there is no flash.

export interface OptimisticEdit<T = unknown> {
  // Prefix-matched: [CacheKey.FacesAll] also updates [CacheKey.FacesAll, 'x'].
  queryKey: readonly unknown[];
  update: (old: T | undefined) => T | undefined;
}

export interface OptimisticContext {
  // Restores every snapshot taken before the optimistic edit.
  rollback: () => void;
}

// Apply one or more optimistic cache edits and return a context with a single
// rollback() that restores all of them. Note: call queryClient.cancelQueries
// for the affected keys before relying on this if an in-flight refetch could
// clobber the optimistic data (see callers).
export function optimisticEdit(
  queryClient: QueryClient,
  edits: OptimisticEdit[],
): OptimisticContext {
  const snapshots: Array<[readonly unknown[], unknown]> = [];

  for (const edit of edits) {
    const matches = queryClient.getQueriesData({ queryKey: edit.queryKey });
    for (const [key, data] of matches) {
      snapshots.push([key, data]);
    }
    queryClient.setQueriesData({ queryKey: edit.queryKey }, (old: unknown) =>
      edit.update(old),
    );
  }

  return {
    rollback: () => {
      for (const [key, data] of snapshots) {
        queryClient.setQueryData(key, data);
      }
    },
  };
}
