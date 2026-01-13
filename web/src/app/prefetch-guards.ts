import { inject } from '@angular/core';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  RouterStateSnapshot,
} from '@angular/router';
import { injectTrpc } from '@core/services/trpc';
import { CacheKey } from '@core/services/cache-key.types';
import { QueryClient } from '@tanstack/angular-query-experimental';

export const prefetchGalleryAll: CanActivateFn = async (
  route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot,
) => {
  const queryClient = inject(QueryClient);
  const trpc = injectTrpc();

  try {
    await queryClient.prefetchInfiniteQuery({
      queryKey: [CacheKey.GalleryAll],
      queryFn: async ({ pageParam }) =>
        trpc.files.getUsersFiles.query({
          kind: 'all',
          limit: 200,
          cursor: pageParam,
        }),
      initialPageParam: null as string | null,
      getNextPageParam: (lastPage: any) => lastPage.nextCursor,
    });
    return true;
  } catch {
    return true;
  }
};

export const prefetchGalleryPhotos: CanActivateFn = async (
  route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot,
) => {
  const queryClient = inject(QueryClient);
  const trpc = injectTrpc();

  try {
    await queryClient.prefetchInfiniteQuery({
      queryKey: [CacheKey.GalleryPhotos],
      queryFn: async ({ pageParam }) =>
        trpc.files.getUsersFiles.query({
          kind: 'image',
          limit: 200,
          cursor: pageParam,
        }),
      initialPageParam: null as string | null,
      getNextPageParam: (lastPage: any) => lastPage.nextCursor,
    });
    return true;
  } catch {
    return true;
  }
};

export const prefetchGalleryVideos: CanActivateFn = async (
  route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot,
) => {
  const queryClient = inject(QueryClient);
  const trpc = injectTrpc();

  try {
    await queryClient.prefetchInfiniteQuery({
      queryKey: [CacheKey.GalleryVideos],
      queryFn: async ({ pageParam }) =>
        trpc.files.getUsersFiles.query({
          kind: 'video',
          limit: 200,
          cursor: pageParam,
        }),
      initialPageParam: null as string | null,
      getNextPageParam: (lastPage: any) => lastPage.nextCursor,
    });
    return true;
  } catch {
    return true;
  }
};

export const prefetchAlbumsAll: CanActivateFn = async (
  route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot,
) => {
  const queryClient = inject(QueryClient);
  const trpc = injectTrpc();

  try {
    await queryClient.prefetchQuery({
      queryKey: [CacheKey.AlbumsAll],
      queryFn: () => trpc.album.getUsersAlbums.query(),
    });
    return true;
  } catch {
    return true;
  }
};

export const prefetchCamerasAll: CanActivateFn = async (
  route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot,
) => {
  const queryClient = inject(QueryClient);
  const trpc = injectTrpc();

  try {
    await queryClient.prefetchQuery({
      queryKey: [CacheKey.CamerasAll],
      queryFn: () => trpc.camera.getAllCameras.query(),
    });
    return true;
  } catch {
    return true;
  }
};
