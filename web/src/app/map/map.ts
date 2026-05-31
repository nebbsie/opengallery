import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  afterNextRender,
  effect,
  signal,
  viewChild,
} from '@angular/core';
import { ErrorAlert } from '@core/components/error/error';
import { injectTrpc } from '@core/services/trpc';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideMap } from '@ng-icons/lucide';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { Loading } from '@core/components/loading/loading';
import type * as L from 'leaflet';
import { loadLeafletWithCluster } from './leaflet-cluster';

type LocationPoint = { lat: number; lon: number; count: number };

@Component({
  selector: 'app-map',
  providers: [provideIcons({ lucideMap })],
  imports: [ErrorAlert, Loading, NgIcon, HlmIcon],
  host: { class: 'block h-full' },
  template: `
    @if (error()) {
      <app-error-alert [error]="error()" />
    } @else {
      <div class="mb-6">
        <h1 class="text-foreground mb-2 text-2xl font-bold">World Map</h1>
        <p class="text-muted-foreground text-sm">Browse photos by location around the world</p>
      </div>

      <div class="relative h-[calc(100vh-12rem)] w-full">
        <div #mapContainer class="h-full w-full rounded-lg border"></div>

        @if (loading()) {
          <div class="bg-background/60 absolute inset-0 flex items-center justify-center rounded-lg">
            <app-loading />
          </div>
        } @else if (empty()) {
          <div
            class="text-muted-foreground absolute inset-0 flex flex-col items-center justify-center rounded-lg"
          >
            <ng-icon hlm size="xl" name="lucideMap" class="mb-4" />
            <p>No locations found</p>
            <p class="text-sm">Photos with geolocation data will appear here</p>
          </div>
        }
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Map implements OnDestroy {
  private readonly trpc = injectTrpc();
  private map: L.Map | null = null;
  private leaflet: typeof L | null = null;
  private clusterGroup: L.MarkerClusterGroup | null = null;
  // Guards against the init effect re-entering during the async leaflet load.
  private initializing = false;
  // Discards responses for viewports the user has already panned away from.
  private fetchToken = 0;
  // The first fetch (world view) decides the empty state and the initial fit.
  private firstFetch = true;

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
    // Invalidate any in-flight fetch so its late response can't touch a torn-down map.
    this.fetchToken++;
    if (this.map) {
      this.map.remove();
      this.map = null;
      this.clusterGroup = null;
    }
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
    if (!this.mapContainer()) {
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
      zoomControl: true,
      attributionControl: true,
    });

    leaflet.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom: 20,
      subdomains: 'abcd',
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
        const childMarkers = cluster.getAllChildMarkers();
        let totalCount = 0;
        childMarkers.forEach((m) => {
          totalCount += (m.options as { photoCount?: number }).photoCount || 1;
        });

        const size = totalCount >= 100 ? 54 : totalCount >= 10 ? 44 : 36;
        const bg = totalCount >= 100 ? '#ec4899' : totalCount >= 10 ? '#8b5cf6' : '#3b82f6';
        const label =
          totalCount >= 1000 ? `${Math.round(totalCount / 100) / 10}k` : `${totalCount}`;

        // Inline styles (not CSS classes) so the bubble always renders — Leaflet
        // builds these nodes in JS, outside Angular's view encapsulation.
        return leaflet.divIcon({
          html:
            `<div style="display:flex;align-items:center;justify-content:center;` +
            `width:${size}px;height:${size}px;border-radius:9999px;background:${bg};` +
            `color:#fff;font-weight:600;font-size:13px;` +
            `box-shadow:0 2px 8px rgba(0,0,0,0.2),0 0 0 4px rgba(59,130,246,0.3)">${label}</div>`,
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

      // A newer fetch started (or the map was destroyed) — drop this response.
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
            result.locations.map((l) => [l.lat, l.lon]),
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

    clusterGroup.clearLayers();

    for (const location of locations) {
      const marker = leaflet.marker([location.lat, location.lon], {
        icon: leaflet.divIcon({
          html:
            '<div style="width:14px;height:14px;background:#3b82f6;' +
            'border:2.5px solid #fff;border-radius:9999px;' +
            'box-shadow:0 1px 4px rgba(0,0,0,0.3)"></div>',
          className: '',
          iconSize: leaflet.point(14, 14),
          iconAnchor: leaflet.point(7, 7),
        }),
        photoCount: location.count,
      } as L.MarkerOptions);

      if (precise) {
        // Exact coordinate: link straight through to its photos.
        const photoLabel = `${location.count} photo${location.count > 1 ? 's' : ''}`;
        marker.bindPopup(`
          <div style="text-align:center;min-width:120px">
            <p style="font-weight:600;margin:0 0 4px">${photoLabel}</p>
            <a href="/locations/${location.lat}/${location.lon}"
               style="color:#2563eb;text-decoration:underline">
              View photos
            </a>
          </div>
        `);
      } else {
        // Aggregated cell centroid: the coordinate is approximate, so zoom in
        // toward it rather than linking out to a point that may hold no photos.
        marker.on('click', () => {
          if (!this.map) return;
          this.map.flyTo([location.lat, location.lon], Math.min(this.map.getZoom() + 3, 18));
        });
      }

      clusterGroup.addLayer(marker);
    }
  }
}
