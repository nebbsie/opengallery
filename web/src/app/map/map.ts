import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  effect,
  viewChild,
} from '@angular/core';
import { ErrorAlert } from '@core/components/error/error';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideMap } from '@ng-icons/lucide';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { injectQuery } from '@tanstack/angular-query-experimental';
import * as L from 'leaflet';
import 'leaflet.markercluster';

@Component({
  selector: 'app-map',
  providers: [provideIcons({ lucideMap })],
  imports: [ErrorAlert, HlmSpinner, NgIcon, HlmIcon],
  host: { class: 'block h-full' },
  template: `
    @if (locations.isPending() && !locations.data()) {
      <hlm-spinner />
    } @else if (locations.isError() && !locations.data()) {
      <app-error-alert [error]="locations.error()" />
    } @else {
      <div class="mb-6">
        <h1 class="text-foreground mb-2 text-2xl font-bold">World Map</h1>
        <p class="text-muted-foreground text-sm">Browse photos by location around the world</p>
      </div>

      @if (locations.data()!.length === 0) {
        <div class="text-muted-foreground flex flex-col items-center justify-center py-12">
          <ng-icon hlm size="xl" name="lucideMap" class="mb-4" />
          <p>No locations found</p>
          <p class="text-sm">Photos with geolocation data will appear here</p>
        </div>
      } @else {
        <div #mapContainer class="h-[calc(100vh-12rem)] w-full rounded-lg border"></div>
      }
    }
  `,
  styles: `
    :host ::ng-deep .photo-cluster {
      background: transparent;
    }
    :host ::ng-deep .photo-cluster-inner {
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 9999px;
      font-weight: 600;
      color: white;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
      box-shadow:
        0 2px 8px rgba(0, 0, 0, 0.2),
        0 0 0 4px rgba(59, 130, 246, 0.3);
      transition: transform 0.15s ease;
    }
    :host ::ng-deep .photo-cluster-inner:hover {
      transform: scale(1.1);
    }
    :host ::ng-deep .photo-cluster-small .photo-cluster-inner {
      width: 36px;
      height: 36px;
      font-size: 12px;
      background: #3b82f6;
    }
    :host ::ng-deep .photo-cluster-medium .photo-cluster-inner {
      width: 44px;
      height: 44px;
      font-size: 13px;
      background: #8b5cf6;
    }
    :host ::ng-deep .photo-cluster-large .photo-cluster-inner {
      width: 54px;
      height: 54px;
      font-size: 14px;
      background: #ec4899;
    }
    :host ::ng-deep .photo-marker {
      background: transparent;
      border: none;
    }
    :host ::ng-deep .photo-marker-dot {
      width: 14px;
      height: 14px;
      background: #3b82f6;
      border: 2.5px solid white;
      border-radius: 9999px;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
      transition: transform 0.15s ease;
    }
    :host ::ng-deep .photo-marker-dot:hover {
      transform: scale(1.3);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Map implements OnDestroy {
  private readonly trpc = injectTrpc();
  private map: L.Map | null = null;
  private clusterGroup: L.MarkerClusterGroup | null = null;
  protected readonly mapContainer = viewChild<ElementRef<HTMLDivElement>>('mapContainer');

  locations = injectQuery(() => ({
    queryKey: [CacheKey.LocationAll],
    queryFn: async () => this.trpc.geoLocation.getAllLocations.query(),
  }));

  constructor() {
    effect(() => {
      const data = this.locations.data();
      const container = this.mapContainer();

      if (data && container) {
        this.initMap(data);
      }
    });
  }

  ngOnDestroy(): void {
    if (this.map) {
      this.map.remove();
      this.map = null;
      this.clusterGroup = null;
    }
  }

  private initMap(locations: { lat: number; lon: number; count: number }[]): void {
    const container = this.mapContainer();
    if (!container || this.map) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (L.Icon.Default.prototype as any)._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    });

    this.map = L.map(container.nativeElement, {
      center: [20, 0],
      zoom: 2,
      zoomControl: true,
      attributionControl: true,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap contributors © CARTO',
      maxZoom: 20,
    }).addTo(this.map);

    this.clusterGroup = L.markerClusterGroup({
      maxClusterRadius: (zoom: number) => {
        if (zoom <= 3) return 120;
        if (zoom <= 6) return 80;
        if (zoom <= 10) return 60;
        if (zoom <= 14) return 40;
        return 20;
      },
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      animate: true,
      animateAddingMarkers: false,
      disableClusteringAtZoom: 18,
      iconCreateFunction: (cluster: L.MarkerCluster) => {
        const childMarkers = cluster.getAllChildMarkers();
        let totalCount = 0;
        childMarkers.forEach((m) => {
          totalCount += (m.options as { photoCount?: number }).photoCount || 1;
        });

        let sizeClass = 'photo-cluster-small';
        if (totalCount >= 100) {
          sizeClass = 'photo-cluster-large';
        } else if (totalCount >= 10) {
          sizeClass = 'photo-cluster-medium';
        }

        const label =
          totalCount >= 1000 ? `${Math.round(totalCount / 100) / 10}k` : `${totalCount}`;

        return L.divIcon({
          html: `<div class="photo-cluster-inner">${label}</div>`,
          className: `photo-cluster ${sizeClass}`,
          iconSize: L.point(54, 54),
          iconAnchor: L.point(27, 27),
        });
      },
    });

    const bounds: [number, number][] = [];

    locations.forEach((location) => {
      const marker = L.marker([location.lat, location.lon], {
        icon: L.divIcon({
          html: '<div class="photo-marker-dot"></div>',
          className: 'photo-marker',
          iconSize: L.point(14, 14),
          iconAnchor: L.point(7, 7),
        }),
        photoCount: location.count,
      } as L.MarkerOptions);

      marker.bindPopup(`
        <div class="p-2 text-center">
          <p class="font-semibold">${location.count} photo${location.count > 1 ? 's' : ''}</p>
          <a href="/locations/${location.lat}/${location.lon}"
             class="text-blue-600 hover:text-blue-800 underline"
             target="_self">
            View photos
          </a>
        </div>
      `);

      this.clusterGroup!.addLayer(marker);
      bounds.push([location.lat, location.lon]);
    });

    this.map.addLayer(this.clusterGroup);

    if (bounds.length > 0 && this.map) {
      this.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 10 });
    }
  }
}
