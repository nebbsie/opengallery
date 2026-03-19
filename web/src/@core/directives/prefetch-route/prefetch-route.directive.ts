import { isPlatformBrowser } from '@angular/common';
import { DestroyRef, Directive, HostListener, Input, PLATFORM_ID, inject } from '@angular/core';
import { PRIMARY_OUTLET, Route, Router, RouterLink, Routes } from '@angular/router';
import { PrefetchService } from '@core/services/prefetch/prefetch';

type PrefetchMethodName =
  | 'prefetchAlbums'
  | 'prefetchCameras'
  | 'prefetchGalleryAll'
  | 'prefetchGalleryPhotos'
  | 'prefetchGalleryVideos';

@Directive({
  selector: '[flPrefetchRoute]',
  standalone: true,
})
export class PrefetchRouteDirective {
  private static readonly prefetchedUrls = new Set<string>();

  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly prefetchService = inject(PrefetchService);
  private readonly router = inject(Router);
  private readonly routerLink = inject(RouterLink, {
    optional: true,
    self: true,
  });

  @Input() flPrefetchRoute: boolean | '' = true;

  private debounceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.destroyRef.onDestroy(() => this.clearTimer());
  }

  @HostListener('mouseenter')
  @HostListener('focusin')
  onPointerEnter(): void {
    if (this.flPrefetchRoute === false || !isPlatformBrowser(this.platformId) || !this.routerLink) {
      return;
    }

    this.clearTimer();
    this.debounceTimer = setTimeout(() => this.prefetch(), 100);
  }

  @HostListener('mouseleave')
  @HostListener('focusout')
  onPointerLeave(): void {
    this.clearTimer();
  }

  private prefetch(): void {
    const urlTree = this.routerLink?.urlTree;
    if (!urlTree) {
      return;
    }

    const url = this.router.serializeUrl(urlTree);
    if (PrefetchRouteDirective.prefetchedUrls.has(url)) {
      return;
    }
    PrefetchRouteDirective.prefetchedUrls.add(url);

    const segments =
      urlTree.root.children[PRIMARY_OUTLET]?.segments.map((segment) => segment.path) ?? [];

    this.prefetchRouteData(segments);
    this.loadLazyBoundaries(this.router.config, segments, 0, url);
  }

  private prefetchRouteData(segments: string[]): void {
    const methodName = this.getPrefetchMethodName(segments);
    if (!methodName) {
      return;
    }

    const prefetchMethod = this.prefetchService[methodName] as (() => void) | undefined;
    prefetchMethod?.call(this.prefetchService);
  }

  private getPrefetchMethodName(segments: string[]): PrefetchMethodName | undefined {
    const joinedPath = `/${segments.join('/')}`;

    switch (joinedPath) {
      case '/gallery':
        return 'prefetchGalleryAll';
      case '/gallery/photos':
        return 'prefetchGalleryPhotos';
      case '/gallery/videos':
        return 'prefetchGalleryVideos';
      case '/albums':
        return 'prefetchAlbums';
      case '/cameras':
        return 'prefetchCameras';
      default:
        return undefined;
    }
  }

  private loadLazyBoundaries(
    routes: readonly Route[],
    segments: string[],
    index: number,
    url: string,
  ): void {
    for (const route of this.findActionableMatches(routes, segments, index)) {
      const nextIndex = index + this.segmentsOf(route).length;

      if (route.redirectTo && typeof route.redirectTo === 'string') {
        this.followRedirect(route, routes, segments, index, url);
        return;
      }

      if (route.loadChildren) {
        this.loadModuleAndContinue(route.loadChildren(), segments, nextIndex, url);
        return;
      }

      if (route.loadComponent) {
        this.loadBundle(route.loadComponent(), url);
        if (route.children) {
          this.loadLazyBoundaries(route.children, segments, nextIndex, url);
        }
        return;
      }

      if (route.children) {
        this.loadLazyBoundaries(route.children, segments, nextIndex, url);
        return;
      }
    }
  }

  private findActionableMatches(
    routes: readonly Route[],
    segments: string[],
    index: number,
  ): Route[] {
    return routes.filter((route) => {
      const pathSegments = this.segmentsOf(route);
      if (!this.pathMatchesUrl(pathSegments, segments, index)) {
        return false;
      }
      const nextIndex = index + pathSegments.length;
      return this.hasAction(route, pathSegments, nextIndex, segments.length);
    });
  }

  private segmentsOf(route: Route): string[] {
    return (route.path ?? '').split('/').filter((segment) => segment.length > 0);
  }

  private pathMatchesUrl(
    pathSegments: readonly string[],
    urlSegments: readonly string[],
    startIndex: number,
  ): boolean {
    if (pathSegments.length === 0) {
      return true;
    }

    return pathSegments.every((segment, offset) => {
      const urlIndex = startIndex + offset;
      if (urlIndex >= urlSegments.length) {
        return false;
      }
      if (segment.startsWith(':') || segment === '**') {
        return true;
      }
      return segment === urlSegments[urlIndex];
    });
  }

  private hasAction(
    route: Route,
    pathSegments: string[],
    nextIndex: number,
    totalSegments: number,
  ): boolean {
    if (route.redirectTo && route.pathMatch === 'full' && nextIndex < totalSegments) {
      return false;
    }

    if (pathSegments.length === 0) {
      return !!(route.redirectTo || route.loadChildren || route.loadComponent || route.children);
    }

    return true;
  }

  private followRedirect(
    route: Route,
    allRoutes: readonly Route[],
    segments: string[],
    index: number,
    url: string,
  ): void {
    const target = route.redirectTo as string;
    const redirectSegments = target.split('/').filter((segment) => segment.length > 0);
    const newSegments = [...segments.slice(0, index), ...redirectSegments];

    this.loadLazyBoundaries(
      allRoutes.filter((candidate) => candidate !== route),
      newSegments,
      index,
      url,
    );
  }

  private loadModuleAndContinue(
    result: unknown,
    segments: string[],
    index: number,
    url: string,
  ): void {
    const pendingResult = this.asPromise(result);
    if (!pendingResult) {
      return;
    }

    pendingResult
      .then((resolved) => {
        const childRoutes = this.extractRoutes(resolved);
        if (childRoutes && childRoutes.length > 0) {
          this.loadLazyBoundaries(childRoutes, segments, index, url);
        }
      })
      .catch((error: unknown) => this.handleLoadError(url, error));
  }

  private loadBundle(result: unknown, url: string): void {
    const pendingResult = this.asPromise(result);
    if (!pendingResult) {
      return;
    }

    pendingResult.catch((error: unknown) => this.handleLoadError(url, error));
  }

  private asPromise<T>(value: T | Promise<T>): Promise<T> | undefined {
    if (value && typeof value === 'object' && 'then' in value) {
      return value as Promise<T>;
    }

    return undefined;
  }

  private extractRoutes(resolved: unknown): Routes | undefined {
    if (Array.isArray(resolved)) {
      return resolved;
    }

    if (resolved && typeof resolved === 'object') {
      const asModule = resolved as { routes?: unknown };
      if (Array.isArray(asModule.routes)) {
        return asModule.routes;
      }
    }

    return undefined;
  }

  private handleLoadError(url: string, error: unknown): void {
    console.warn('[flPrefetchRoute] bundle load failed', error);
    PrefetchRouteDirective.prefetchedUrls.delete(url);
  }

  private clearTimer(): void {
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
  }
}
