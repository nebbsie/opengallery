import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  afterNextRender,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { environment } from '@env/environment';
import { ErrorAlert } from '@core/components/error/error';
import { injectTrpc } from '@core/services/trpc';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideMap } from '@ng-icons/lucide';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { Loading } from '@core/components/loading/loading';
import type * as L from 'leaflet';
import { loadLeafletWithCluster } from './leaflet-cluster';

type LocationPoint = { lat: number; lon: number; count: number; cover?: string | null };

type PinOptions = L.MarkerOptions & { photoCount: number; cover: string | null };

const formatCount = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : `${n}`);

// Photo pin markup. Leaflet builds these nodes outside Angular, so the styles
// are inline. White frame + soft shadow reads on light and dark tiles alike.
function pinHtml(apiUrl: string, cover: string | null, count: number, size: number): string {
  const img = cover
    ? `<img src="${apiUrl}/asset/${cover}/thumbnail" alt="" loading="lazy" decoding="async" ` +
      `style="width:100%;height:100%;object-fit:cover;display:block" />`
    : `<div style="width:100%;height:100%;background:#94a3b8"></div>`;
  const badge =
    count > 1
      ? `<span style="position:absolute;top:-8px;right:-8px;min-width:22px;height:22px;padding:0 6px;` +
        `border-radius:9999px;background:#fff;color:#111;font:600 12px/22px system-ui,sans-serif;` +
        `text-align:center;font-variant-numeric:tabular-nums;box-shadow:0 1px 4px rgba(0,0,0,0.3)">${formatCount(count)}</span>`
      : '';
  return (
    `<div style="position:relative;width:${size}px;height:${size}px">` +
    `<div style="width:100%;height:100%;border-radius:10px;overflow:hidden;border:2px solid #fff;` +
    `box-shadow:0 2px 8px rgba(0,0,0,0.35);background:#e2e8f0">${img}</div>${badge}</div>`
  );
}

@Component({
  selector: 'app-map',
  providers: [provideIcons({ lucideMap })],
  imports: [ErrorAlert, Loading, NgIcon, HlmIcon],
  host: { class: 'flex min-h-0 flex-1 flex-col' },
  template: `
    @if (error()) {
      <app-error-alert [error]="error()" />
    } @else {
      <div class="relative min-h-0 w-full flex-1">
        <div #mapContainer class="absolute inset-0 rounded-lg"></div>

        @if (loading()) {
          <div class="bg-background/60 absolute inset-0 flex items-center justify-center rounded-lg">
            <app-loading />
          </div>
        } @else if (empty()) {
          <div
            class="text-muted-foreground absolute inset-0 flex flex-col items-center justify-center rounded-lg"
          >
            <ng-icon hlm size="xl" name="lucideMap" class="mb-4" />
            <p class="text-foreground font-medium">No places yet</p>
          </div>
        }
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Map implements OnDestroy {
  private readonly trpc = injectTrpc();
  private readonly router = inject(Router);
  private readonly apiUrl = environment.api.url;
  // Markers on the map now, keyed by position and kind, so a pan only adds and
  // removes the pins that changed instead of redrawing all of them.
  private markers = new globalThis.Map<string, L.Marker>();
  private map: L.Map | null = null;
  private leaflet: typeof L | null = null;
  private clusterGroup: L.MarkerClusterGroup | null = null;
  // Guards against the init effect re-entering during the async leaflet load.
  private initializing = false;
  // Discards responses for viewports the user has already panned away from.
  private fetchToken = 0;
  // The first fetch (world view) decides the empty state and the initial fit.
  private firstFetch = true;
  private destroyed = false;

  private readonly clientReady = signal(false);
  protected readonly loading = signal(true);
  protected readonly empty = signal(false);
  protected readonly error = signal<Error | undefined>(undefined);
  protected readonly mapContainer = viewChild<ElementRef<HTMLDivElement>>('mapContainer');

  constructor() {
    // Defer map initialization until the browser has completed its first render.
    // This prevents conflicts with Angular SSR hydration and ensures the DOM is stable.
    afterNextRender(() => {
      this.clientReady.set(true);
    });

    effect(() => {
      if (!this.clientReady()) return;
      const container = this.mapContainer();
      if (container) {
        void this.initMap();
      }
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    // Invalidate any in-flight fetch so its late response can't touch a torn-down map.
    this.fetchToken++;
    if (this.map) {
      this.map.remove();
      this.map = null;
      this.clusterGroup = null;
    }
    this.markers.clear();
  }

  private async initMap(): Promise<void> {
    const container = this.mapContainer();
    if (!container || this.map || this.initializing) return;
    this.initializing = true;

    // Load leaflet + the markercluster plugin against a shared global `L`. See
    // leaflet-cluster.ts for why this can't be a plain top-level import.
    const leaflet = await loadLeafletWithCluster();
    this.leaflet = leaflet;

    // The component may have been destroyed while leaflet was loading.
    if (this.destroyed || !this.mapContainer()) {
      this.initializing = false;
      return;
    }

    // Use local assets instead of CDN so the map works without internet access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (leaflet.Icon.Default.prototype as any)._getIconUrl;
    leaflet.Icon.Default.mergeOptions({
      iconRetinaUrl: 'assets/leaflet/marker-icon-2x.png',
      iconUrl: 'assets/leaflet/marker-icon.png',
      shadowUrl: 'assets/leaflet/marker-shadow.png',
    });

    this.map = leaflet.map(container.nativeElement, {
      center: [20, 0],
      zoom: 2,
      // The marker clusters need a max zoom; vector tiles stay sharp to here.
      maxZoom: 19,
      zoomControl: true,
      attributionControl: true,
    });
    // Leaflet's default prefix has a flag icon; keep only the plain link. The
    // OpenStreetMap credit after it stays (the data licence needs it).
    this.map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');

    // Base map: OpenFreeMap vector tiles (free and open source, no API key, no
    // usage limits), drawn by MapLibre GL inside Leaflet. CARTO's free raster
    // tiles now need an API key. The style follows the app theme.
    // MapLibre finds its web worker next to its own module by default, which
    // breaks once the app is bundled; serve the worker as an asset instead
    // (copied in angular.json).
    const maplibre = await import('maplibre-gl');
    maplibre.setWorkerUrl(new URL('assets/maplibre/maplibre-gl-worker.mjs', document.baseURI).href);
    const { maplibreGL } = await import('@maplibre/maplibre-gl-leaflet');
    if (this.destroyed || !this.map) {
      this.initializing = false;
      return;
    }
    const dark = document.documentElement.classList.contains('dark');
    maplibreGL({
      style: `https://tiles.openfreemap.org/styles/${dark ? 'dark' : 'liberty'}`,
      // The style's sources carry the OpenFreeMap / OpenStreetMap credit, and
      // the layer adds it to Leaflet's attribution control.
    }).addTo(this.map);

    // Cluster radius scales with zoom: large radius at world-view collapses continents,
    // shrinks progressively so city/town/road groupings emerge as the user zooms in.
    this.clusterGroup = leaflet.markerClusterGroup({
      maxClusterRadius: (zoom: number) => {
        if (zoom <= 4) return 100;  // continent / country level
        if (zoom <= 7) return 80;   // country / region level
        if (zoom <= 10) return 60;  // region / county level
        if (zoom <= 13) return 40;  // city / town level
        if (zoom <= 16) return 25;  // neighbourhood / road level
        return 15;                  // street / building level
      },
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      animate: true,
      animateAddingMarkers: false,
      disableClusteringAtZoom: 19,
      chunkedLoading: true,
      iconCreateFunction: (cluster: L.MarkerCluster) => {
        // The cluster shows the photo of its biggest child and the total count.
        let totalCount = 0;
        let best: PinOptions | null = null;
        for (const m of cluster.getAllChildMarkers()) {
          const o = m.options as PinOptions;
          totalCount += o.photoCount || 1;
          if (o.cover && (!best || o.photoCount > best.photoCount)) best = o;
        }
        const size = 52;
        return leaflet.divIcon({
          html: pinHtml(this.apiUrl, best?.cover ?? null, totalCount, size),
          className: '',
          iconSize: leaflet.point(size, size),
          iconAnchor: leaflet.point(size / 2, size / 2),
        });
      },
    });

    this.map.addLayer(this.clusterGroup);

    // Refetch the visible points whenever the user finishes panning/zooming.
    this.map.on('moveend', () => void this.fetchAndRender());

    this.initializing = false;

    // Leaflet measures the container at init time. In this async/SPA flow the
    // map div may not have settled its viewport-relative (calc) height yet, so
    // recalc size on the next frame and again shortly after before the first
    // fetch fits to the data.
    const settle = () => {
      if (!this.map) return;
      this.map.invalidateSize();
    };
    requestAnimationFrame(settle);
    setTimeout(settle, 250);

    void this.fetchAndRender();
  }

  private async fetchAndRender(): Promise<void> {
    if (!this.map) return;
    const bounds = this.map.getBounds();
    const zoom = Math.round(this.map.getZoom());
    const token = ++this.fetchToken;

    try {
      const result = await this.trpc.geoLocation.getInBounds.query({
        minLat: bounds.getSouth(),
        maxLat: bounds.getNorth(),
        minLon: bounds.getWest(),
        maxLon: bounds.getEast(),
        zoom,
      });

      // A newer fetch started (or the map was destroyed). Drop this response.
      if (token !== this.fetchToken || !this.map) return;

      this.renderLocations(result.locations, result.precise);
      this.loading.set(false);

      if (this.firstFetch) {
        this.firstFetch = false;
        this.empty.set(result.locations.length === 0);
        if (result.locations.length > 0) {
          // Fitting bounds triggers another moveend, which fetches points for
          // the now-accurate viewport.
          this.map.fitBounds(
            result.locations.map((l: LocationPoint) => [l.lat, l.lon] as [number, number]),
            { padding: [50, 50], maxZoom: 12 },
          );
        }
      }
    } catch (err) {
      if (token !== this.fetchToken) return;
      this.loading.set(false);
      // Only surface a hard error before the map ever rendered points; transient
      // pan/zoom fetch failures shouldn't blow away a working map.
      if (this.firstFetch) {
        this.error.set(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  private renderLocations(locations: LocationPoint[], precise: boolean): void {
    const leaflet = this.leaflet;
    const clusterGroup = this.clusterGroup;
    if (!leaflet || !clusterGroup) return;

    const next = new globalThis.Map<string, LocationPoint>();
    for (const location of locations) {
      next.set(`${precise ? 'p' : 'a'}:${location.lat.toFixed(5)},${location.lon.toFixed(5)}:${location.count}:${location.cover ?? ''}`, location);
    }

    const stale: L.Marker[] = [];
    for (const [key, marker] of this.markers) {
      if (!next.has(key)) {
        stale.push(marker);
        this.markers.delete(key);
      }
    }
    if (stale.length) clusterGroup.removeLayers(stale);

    const added: L.Marker[] = [];
    for (const [key, location] of next) {
      if (this.markers.has(key)) continue;
      const marker = this.createMarker(leaflet, location, precise);
      this.markers.set(key, marker);
      added.push(marker);
    }
    if (added.length) clusterGroup.addLayers(added);
  }

  private createMarker(leaflet: typeof L, location: LocationPoint, precise: boolean): L.Marker {
    const size = 44;
    const options: PinOptions = {
      icon: leaflet.divIcon({
        html: pinHtml(this.apiUrl, location.cover ?? null, location.count, size),
        className: '',
        iconSize: leaflet.point(size, size),
        iconAnchor: leaflet.point(size / 2, size / 2),
      }),
      photoCount: location.count,
      cover: location.cover ?? null,
      keyboard: true,
      title: `${location.count} ${location.count === 1 ? 'photo' : 'photos'}`,
      alt: `${location.count} ${location.count === 1 ? 'photo' : 'photos'}`,
    };
    const marker = leaflet.marker([location.lat, location.lon], options);

    marker.on('click', () => {
      if (!this.map) return;
      if (precise) {
        // Exact coordinate: open its photos in the app (no page reload).
        void this.router.navigate(['/locations', location.lat, location.lon]);
      } else {
        // Aggregated cell centroid: the coordinate is approximate, so zoom in
        // toward it rather than linking out to a point that may hold no photos.
        this.map.flyTo([location.lat, location.lon], Math.min(this.map.getZoom() + 3, 18));
      }
    });
    return marker;
  }
}
