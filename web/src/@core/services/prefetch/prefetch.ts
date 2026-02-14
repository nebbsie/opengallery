import { inject, Injectable } from '@angular/core';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { environment } from '@env/environment';
import { QueryClient } from '@tanstack/angular-query-experimental';

@Injectable({ providedIn: 'root' })
export class PrefetchService {
  private readonly queryClient = inject(QueryClient);
  private readonly trpc = injectTrpc();
  private readonly apiUrl = environment.api.url;

  private readonly preloadedImages = new Set<string>();
  private readonly pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Prefetch asset detail data and preload the optimised image on hover.
   * Debounced to avoid firing on quick mouse-overs.
   */
  prefetchAsset(
    assetId: string,
    opts?: { albumId?: string; cameraMake?: string; cameraModel?: string },
  ): void {
    if (this.pendingTimers.has(assetId)) return;

    const timer = setTimeout(() => {
      this.pendingTimers.delete(assetId);
      void this.doPrefetchAsset(assetId, opts);
    }, 65);

    this.pendingTimers.set(assetId, timer);
  }

  cancelPrefetchAsset(assetId: string): void {
    const timer = this.pendingTimers.get(assetId);
    if (timer) {
      clearTimeout(timer);
      this.pendingTimers.delete(assetId);
    }
  }

  /**
   * Prefetch gallery list data (used by side-nav hover).
   */
  prefetchGalleryAll(): void {
    void this.queryClient.prefetchInfiniteQuery({
      queryKey: [CacheKey.GalleryAll],
      queryFn: async ({ pageParam }) =>
        this.trpc.files.getUsersFiles.query({ kind: 'all', limit: 200, cursor: pageParam }),
      initialPageParam: null as string | null,
      getNextPageParam: (lastPage: { nextCursor: string | null }) => lastPage.nextCursor,
      staleTime: 30_000,
    });
  }

  prefetchGalleryPhotos(): void {
    void this.queryClient.prefetchInfiniteQuery({
      queryKey: [CacheKey.GalleryPhotos],
      queryFn: async ({ pageParam }) =>
        this.trpc.files.getUsersFiles.query({ kind: 'image', limit: 200, cursor: pageParam }),
      initialPageParam: null as string | null,
      getNextPageParam: (lastPage: { nextCursor: string | null }) => lastPage.nextCursor,
      staleTime: 30_000,
    });
  }

  prefetchGalleryVideos(): void {
    void this.queryClient.prefetchInfiniteQuery({
      queryKey: [CacheKey.GalleryVideos],
      queryFn: async ({ pageParam }) =>
        this.trpc.files.getUsersFiles.query({ kind: 'video', limit: 200, cursor: pageParam }),
      initialPageParam: null as string | null,
      getNextPageParam: (lastPage: { nextCursor: string | null }) => lastPage.nextCursor,
      staleTime: 30_000,
    });
  }

  prefetchAlbums(): void {
    void this.queryClient.prefetchQuery({
      queryKey: [CacheKey.AlbumsAll],
      queryFn: () => this.trpc.album.getUsersAlbums.query(),
      staleTime: 30_000,
    });
  }

  prefetchCameras(): void {
    void this.queryClient.prefetchQuery({
      queryKey: [CacheKey.CamerasAll],
      queryFn: () => this.trpc.camera.getAllCameras.query(),
      staleTime: 30_000,
    });
  }

  private async doPrefetchAsset(
    assetId: string,
    opts?: { albumId?: string; cameraMake?: string; cameraModel?: string },
  ): Promise<void> {
    const queryKey = [
      CacheKey.AssetSingle,
      assetId,
      opts?.albumId ?? null,
      opts?.cameraMake ?? null,
      opts?.cameraModel ?? null,
    ];

    // Prefetch the asset metadata via TanStack Query
    await this.queryClient.prefetchQuery({
      queryKey,
      queryFn: () =>
        this.trpc.files.viewFile.query({
          fileId: assetId,
          albumId: opts?.albumId,
          cameraMake: opts?.cameraMake,
          cameraModel: opts?.cameraModel,
        }),
      staleTime: 60_000,
    });

    // After data is cached, preload the optimised image
    const cached = this.queryClient.getQueryData(queryKey as readonly unknown[]) as
      | { file?: { type?: 'image' | 'video' } }
      | undefined;

    const fileType = cached?.file?.type;
    if (fileType === 'image') {
      this.preloadImage(`${this.apiUrl}/asset/${assetId}/optimised`);
    }
    // Always preload the thumbnail (used as video poster / fallback)
    this.preloadImage(`${this.apiUrl}/asset/${assetId}/thumbnail`);
  }

  private preloadImage(url: string): void {
    if (typeof window === 'undefined') return;
    if (this.preloadedImages.has(url)) return;
    this.preloadedImages.add(url);
    const img = new Image();
    img.decoding = 'async';
    img.loading = 'eager';
    img.src = url;
  }
}
