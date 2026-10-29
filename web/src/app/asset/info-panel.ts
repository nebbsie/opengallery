import { DatePipe, DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  OnDestroy,
  output,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { ToastService } from '@core/services/toast/toast';
import { RouterOutputs } from '@core/services/trpc';
import { environment } from '@env/environment';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCopy, lucideFolder, lucideMapPin, lucideUser, lucideX } from '@ng-icons/lucide';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { HlmIcon } from '@spartan-ng/helm/icon';
import * as L from 'leaflet';
import { assetDate, formatBytes, formatCoords, formatShutterSpeed, getBadgeClass, getMegapixels, getVideoBadgeLabel } from './asset-format';

export type ViewFileData = RouterOutputs['files']['viewFile'];

// The info panel of the viewer: date and place first, then people, albums,
// camera details, the map and the file itself.
@Component({
  selector: 'app-asset-info-panel',
  imports: [RouterLink, NgIcon, HlmIcon, HlmBadge, DatePipe, DecimalPipe],
  providers: [provideIcons({ lucideCopy, lucideFolder, lucideMapPin, lucideUser, lucideX })],
  host: { class: 'block h-full' },
  template: `
    @let d = data();
    @let f = d.file;
    @let m = d.imageMetadata;
    @let when = date();
    <div class="h-full overflow-y-auto px-4 pb-6">
      <!-- Header: when and where -->
      <header class="bg-background sticky top-0 z-10 -mx-4 flex items-start gap-3 px-4 pt-3 pb-3">
        <div class="min-w-0 flex-1 pt-1.5">
          @if (when) {
            <p class="text-foreground text-base font-semibold text-balance">
              {{ when | date: 'EEEE, MMMM d, y' }}
            </p>
            <p class="text-muted-foreground text-sm tabular-nums">
              {{ when | date: 'h:mm a' }}
              @if (!m?.takenAt) {
                <span> · Imported, no capture date</span>
              }
            </p>
          }
          @if (d.geoLocation; as g) {
            <p class="text-muted-foreground mt-1 flex items-center gap-1 text-sm tabular-nums">
              <ng-icon hlm size="xs" name="lucideMapPin" class="shrink-0" />
              <span class="truncate">{{ coords() }}</span>
            </p>
          }
        </div>
        <button
          type="button"
          class="hover:bg-muted focus-visible:ring-ring -mr-2 grid size-11 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-2 active:scale-[0.96]"
          aria-label="Close info"
          (click)="closed.emit()"
        >
          <ng-icon hlm name="lucideX" />
        </button>
      </header>

      <div class="space-y-6 pt-2">
        @if (d.people.length) {
          <section aria-labelledby="info-people">
            <h4 id="info-people" [class]="heading">People</h4>
            <div class="flex flex-wrap gap-3">
              @for (person of d.people; track person.personId) {
                <a
                  [routerLink]="['/faces', person.personId]"
                  class="group focus-visible:ring-ring flex w-16 flex-col items-center gap-1.5 rounded-lg outline-none focus-visible:ring-2"
                  [title]="person.name || 'Unnamed person'"
                >
                  <div
                    class="bg-muted ring-border group-hover:ring-primary h-14 w-14 overflow-hidden rounded-full ring-1 transition-shadow"
                  >
                    @if (person.hasCrop) {
                      <img
                        [src]="apiUrl + '/face/' + person.faceId"
                        [alt]="person.name || 'Unnamed person'"
                        class="h-full w-full object-cover transition-transform group-hover:scale-105"
                        loading="lazy"
                      />
                    } @else {
                      <div class="text-muted-foreground grid h-full w-full place-items-center">
                        <ng-icon hlm name="lucideUser" />
                      </div>
                    }
                  </div>
                  <span
                    class="text-muted-foreground group-hover:text-foreground w-full truncate text-center text-xs transition-colors"
                  >
                    {{ person.name || 'Unnamed' }}
                  </span>
                </a>
              }
            </div>
          </section>
        }

        @if (d.albums.length) {
          <section aria-labelledby="info-albums" class="border-border border-t pt-6">
            <h4 id="info-albums" [class]="heading">Albums</h4>
            <div class="space-y-1">
              @for (album of d.albums; track album.id) {
                <a
                  [routerLink]="['/albums', album.id]"
                  class="text-foreground hover:bg-secondary/50 focus-visible:ring-ring group flex min-h-11 items-center gap-2 rounded-md px-2 text-sm outline-none transition-colors focus-visible:ring-2"
                  [title]="album.name"
                >
                  <ng-icon
                    hlm
                    name="lucideFolder"
                    class="text-muted-foreground group-hover:text-foreground shrink-0 transition-colors"
                  />
                  <span class="truncate">{{ album.name }}</span>
                </a>
              }
            </div>
          </section>
        }

        @if (
          m &&
          (m.takenAt ||
            m.cameraMake ||
            m.cameraModel ||
            m.lensModel ||
            m.iso !== null ||
            m.exposureTime ||
            m.fNumber ||
            m.focalLength !== null)
        ) {
          <section aria-labelledby="info-capture" class="border-border border-t pt-6">
            <h4 id="info-capture" [class]="heading">Capture details</h4>
            <div class="space-y-3">
              @if (m.takenAt) {
                <div [class]="row">
                  <span class="text-muted-foreground text-xs">Taken</span>
                  <span class="text-sm tabular-nums">{{ m.takenAt | date: 'MMM d, y, h:mm a' }}</span>
                </div>
              }
              @if (m.cameraMake || m.cameraModel) {
                <div [class]="row">
                  <span class="text-muted-foreground text-xs">Camera</span>
                  <span class="text-right text-sm font-medium break-words">
                    {{ m.cameraMake || '' }} {{ m.cameraModel || '' }}
                  </span>
                </div>
              }
              @if (m.lensModel) {
                <div [class]="row">
                  <span class="text-muted-foreground text-xs">Lens</span>
                  <span class="text-right text-sm break-words">{{ m.lensModel }}</span>
                </div>
              }
              @if (m.exposureTime || m.fNumber || m.iso !== null || m.focalLength !== null) {
                <div [class]="row">
                  <span class="text-muted-foreground text-xs">Settings</span>
                  <div class="flex flex-wrap justify-end gap-1.5 tabular-nums">
                    @if (m.exposureTime) {
                      <span [class]="chip">{{ shutter(m.exposureTime) }}</span>
                    }
                    @if (m.fNumber) {
                      <span [class]="chip">f/{{ m.fNumber }}</span>
                    }
                    @if (m.iso !== null) {
                      <span [class]="chip">ISO {{ m.iso }}</span>
                    }
                    @if (m.focalLength !== null) {
                      <span [class]="chip">{{ m.focalLength }}mm</span>
                    }
                  </div>
                </div>
              }
            </div>
          </section>
        }

        @if (d.geoLocation; as g) {
          <section aria-labelledby="info-location" class="border-border border-t pt-6">
            <h4 id="info-location" [class]="heading">Location</h4>
            <div
              #mapContainer
              class="border-border h-48 w-full overflow-hidden rounded-lg border shadow-sm"
            ></div>
            <p class="text-muted-foreground mt-2 text-xs tabular-nums">
              {{ +g.lat | number: '1.4-4' }}, {{ +g.lon | number: '1.4-4' }}
            </p>
          </section>
        }

        <section aria-labelledby="info-file" class="border-border border-t pt-6">
          <h4 id="info-file" [class]="heading">File</h4>
          <div class="space-y-3">
            <div [class]="row">
              <span class="text-muted-foreground text-xs">Name</span>
              <span class="text-right text-sm font-medium break-all">{{ f.name }}</span>
            </div>
            @if (m) {
              <div [class]="row">
                <span class="text-muted-foreground text-xs">Dimensions</span>
                <div class="flex items-center gap-2">
                  <span class="text-sm font-medium tabular-nums">{{ m.width }} × {{ m.height }}</span>
                  @if (f.type === 'image') {
                    <span hlmBadge class="bg-primary text-primary-foreground font-bold">{{
                      megapixels(m.width, m.height)
                    }}</span>
                  } @else if (f.type === 'video') {
                    <span hlmBadge [class]="badgeClass(m.height)">{{ videoBadge(m.height) }}</span>
                  }
                </div>
              </div>
            }
            <div [class]="row">
              <span class="text-muted-foreground text-xs">Size</span>
              <span class="text-sm tabular-nums">{{ bytes(f.size) }}</span>
            </div>
            @if (d.raw; as raw) {
              <div [class]="row">
                <span class="text-muted-foreground text-xs">Format</span>
                <span hlmBadge variant="secondary" class="font-semibold">{{ raw.paired ? 'RAW + JPEG' : 'RAW' }}</span>
              </div>
              @if (raw.paired) {
                <div [class]="row">
                  <span class="text-muted-foreground text-xs">RAW file</span>
                  <span class="text-right text-sm font-medium break-all">{{ raw.name }}</span>
                </div>
                <div [class]="row">
                  <span class="text-muted-foreground text-xs">RAW size</span>
                  <span class="text-sm tabular-nums">{{ bytes(raw.size) }}</span>
                </div>
              }
            }
            @if (d.motion; as motion) {
              <div [class]="row">
                <span class="text-muted-foreground text-xs">Live Photo</span>
                <span class="text-right text-sm font-medium break-all">{{ motion.name }}</span>
              </div>
            }
            <div [class]="row">
              <span class="text-muted-foreground text-xs">Imported</span>
              <span class="text-sm tabular-nums">{{ f.createdAt | date: 'MMM d, y, h:mm a' }}</span>
            </div>
            @if (hiddenFromLabel(); as label) {
              <!-- Admin only: who cannot see this file. Opens the picker. -->
              <div [class]="row">
                <span class="text-muted-foreground text-xs">Hidden from</span>
                <button
                  type="button"
                  class="focus-visible:ring-ring rounded text-right text-sm break-words outline-none hover:underline focus-visible:ring-2"
                  title="Change who this is hidden from"
                  (click)="hideFrom.emit()"
                >
                  {{ label }}
                </button>
              </div>
            }
          </div>
        </section>

        <section aria-labelledby="info-disk" class="border-border border-t pt-6">
          <h4 id="info-disk" [class]="heading">On disk</h4>
          <div
            class="bg-secondary/30 text-muted-foreground hover:bg-secondary/50 group relative rounded-md border py-3 pr-12 pl-3 font-mono text-[11px] break-all transition-colors"
          >
            {{ f.dir }}/{{ f.name }}
            <!-- Always visible on touch screens; on hover or focus with a mouse. -->
            <button
              type="button"
              class="hover:bg-muted focus-visible:ring-ring absolute top-0.5 right-0.5 grid size-11 place-items-center rounded-md outline-none transition-[opacity,scale] focus-visible:opacity-100 focus-visible:ring-2 active:scale-[0.96] [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
              aria-label="Copy path"
              title="Copy path"
              (click)="copyPath(f.dir + '/' + f.name)"
            >
              <ng-icon hlm name="lucideCopy" size="sm" />
            </button>
          </div>
        </section>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssetInfoPanel implements OnDestroy {
  protected readonly apiUrl = environment.api.url;
  private readonly toast = inject(ToastService);

  readonly data = input.required<ViewFileData>();
  readonly hiddenFromLabel = input('');
  /** Whether the panel is open. Leaflet needs a resize once it has a size. */
  readonly open = input(false);
  readonly hideFrom = output<void>();
  readonly closed = output<void>();

  protected readonly heading =
    'text-foreground mb-3 text-xs font-semibold tracking-wider uppercase';
  protected readonly row = 'flex items-start justify-between gap-3';
  protected readonly chip =
    'bg-secondary text-secondary-foreground rounded px-2 py-0.5 text-xs font-medium';

  protected readonly date = computed(() => assetDate(this.data()));
  protected readonly coords = computed(() => formatCoords(this.data().geoLocation));

  protected readonly bytes = formatBytes;
  protected readonly megapixels = getMegapixels;
  protected readonly shutter = formatShutterSpeed;
  protected readonly badgeClass = getBadgeClass;
  protected readonly videoBadge = getVideoBadgeLabel;

  private map: L.Map | null = null;
  private readonly mapContainer = viewChild<ElementRef<HTMLDivElement>>('mapContainer');

  constructor() {
    effect(() => {
      const geo = this.data().geoLocation;
      const container = this.mapContainer()?.nativeElement;
      this.removeMap();
      if (geo && container) this.initMap(container, Number(geo.lat), Number(geo.lon));
    });

    effect((onCleanup) => {
      if (!this.open()) return;
      const t = setTimeout(() => this.map?.invalidateSize(), 200);
      onCleanup(() => clearTimeout(t));
    });
  }

  ngOnDestroy(): void {
    this.removeMap();
  }

  protected async copyPath(value: string): Promise<void> {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const el = document.createElement('textarea');
        el.value = value;
        el.setAttribute('readonly', '');
        el.style.position = 'fixed';
        el.style.top = '-9999px';
        document.body.appendChild(el);
        el.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(el);
        if (!ok) throw new Error('copy failed');
      }
      this.toast.success('Path copied');
    } catch {
      this.toast.error('Could not copy the path');
    }
  }

  private removeMap(): void {
    this.map?.remove();
    this.map = null;
  }

  private initMap(container: HTMLDivElement, lat: number, lon: number): void {
    // Fix Leaflet's default icon path in bundled apps.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (L.Icon.Default.prototype as any)._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    });
    this.map = L.map(container, {
      center: [lat, lon],
      zoom: 13,
      zoomControl: false,
      attributionControl: true,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    }).addTo(this.map);
    L.marker([lat, lon]).addTo(this.map);
  }
}
