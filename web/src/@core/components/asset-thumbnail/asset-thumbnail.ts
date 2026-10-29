import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { BlurhashCanvas } from '@core/components/blurhash-canvas/blurhash-canvas';
import { GRID_CELL } from '@core/components/virtual-thumbnail-grid/grid-layout';
import { PrefetchService } from '@core/services/prefetch/prefetch';
import { GridSelection } from '@core/services/selection/grid-selection';
import { environment } from '@env/environment';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCheck, lucideCirclePause, lucideCirclePlay } from '@ng-icons/lucide';
import { HlmIcon } from '@spartan-ng/helm/icon';

export interface ThumbnailAsset {
  type: 'image' | 'video';
  id: string;
  blurhash?: string | null;
  takenAt?: Date | string | null;
  // Has a camera RAW (RAW + JPEG pair) or is one.
  hasRaw?: boolean;
}

const LONG_PRESS_MS = 450;
const LONG_PRESS_SLOP_PX = 10;

const altDate = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

@Component({
  selector: 'app-asset-thumbnail',
  imports: [HlmIcon, NgIcon, BlurhashCanvas],
  providers: [
    provideIcons({
      lucideCirclePlay,
      lucideCirclePause,
      lucideCheck,
    }),
  ],
  host: {
    class: 'group relative block overflow-hidden rounded-lg transition-colors duration-150',
    '[class.aspect-square]': '!justified()',
    '[class.h-full]': 'justified()',
    '[class.w-full]': 'justified()',
    '[class.bg-muted]': '!selected()',
    '[class.bg-primary/15]': 'selected()',
  },
  styles: `
    a {
      -webkit-touch-callout: none;
      -webkit-user-select: none;
      user-select: none;
    }
  `,
  template: `
    @let _asset = asset();
    <a
      class="absolute inset-0 block outline-offset-2"
      [href]="href()"
      [attr.data-asset-id]="_asset.id"
      [attr.aria-pressed]="selection ? selected() : null"
      draggable="false"
      (click)="onClick($event)"
      (keydown)="onKeydown($event)"
      (mouseenter)="onHover()"
      (mouseleave)="onHoverEnd()"
      (pointerdown)="onPointerDown($event)"
      (pointermove)="onPointerMove($event)"
      (pointerup)="cancelPress()"
      (pointercancel)="cancelPress()"
      (contextmenu)="onContextMenu($event)"
    >
      <div
        class="absolute inset-0 overflow-hidden transition-[scale,border-radius] duration-150 ease-out"
        [class]="selected() ? 'scale-[0.86] rounded-md' : ''"
      >
        @if (_asset.blurhash && !imageLoaded()) {
          <app-blurhash-canvas
            class="absolute inset-0 h-full w-full"
            [blurhash]="_asset.blurhash"
            [width]="32"
            [height]="32"
          />
        }
        <!-- sizes and srcset are bound before src so the browser fetches one file. -->
        <img
          class="absolute inset-0 h-full w-full object-cover outline outline-1 -outline-offset-1 outline-black/10 transition-opacity duration-300 dark:outline-white/10"
          [class.opacity-0]="!imageLoaded()"
          [attr.sizes]="justified() ? null : sizes()"
          [attr.srcset]="justified() ? null : smallUrl() + ' 320w, ' + largeUrl() + ' 640w'"
          [src]="justified() ? largeUrl() : smallUrl()"
          [alt]="alt()"
          width="400"
          height="400"
          loading="lazy"
          decoding="async"
          draggable="false"
          (load)="onImageLoad()"
        />

        @if (_asset.type === 'video') {
          <div
            class="absolute top-2 right-2 grid h-8 w-8 place-items-center rounded-full bg-black/60 shadow-md backdrop-blur-sm"
          >
            <ng-icon class="h-4 w-4 text-white drop-shadow-md" hlm name="lucideCirclePlay" />
          </div>
        }
      </div>
    </a>

    @if (selection) {
      <!-- Scrim so the white check circle reads on light photos. -->
      <div
        class="pointer-events-none absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-black/35 to-transparent opacity-0 transition-opacity duration-150"
        [class]="selected() ? '' : 'group-hover:opacity-100'"
        aria-hidden="true"
      ></div>
      <button
        type="button"
        tabindex="-1"
        data-select-check
        class="absolute top-0.5 left-0.5 grid size-8 place-items-center rounded-full transition-[opacity,scale] duration-150 ease-out focus-visible:opacity-100 active:scale-[0.96]"
        [class]="selection.active() ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
        role="checkbox"
        [attr.aria-checked]="selected()"
        [attr.aria-label]="(selected() ? 'Deselect ' : 'Select ') + alt()"
        (click)="onCheckClick($event)"
      >
        <span
          class="grid size-[18px] place-items-center rounded-full shadow-sm transition-colors duration-150"
          [class]="
            selected()
              ? 'bg-primary text-primary-foreground ring-[1.5px] ring-white'
              : 'bg-black/20 text-white/0 ring-[1.5px] ring-white/90 hover:text-white/90'
          "
        >
          <ng-icon hlm size="12px" name="lucideCheck" />
        </span>
      </button>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssetThumbnail implements OnDestroy {
  protected readonly apiUrl = environment.api.url;
  protected readonly imageLoaded = signal(false);
  private readonly prefetch = inject(PrefetchService);
  private readonly router = inject(Router);
  protected readonly selection = inject(GridSelection, { optional: true });
  private readonly cell = inject(GRID_CELL, { optional: true });

  asset = input.required<ThumbnailAsset>();
  from = input<string>();
  albumId = input<string>();
  cameraMake = input<string>();
  cameraModel = input<string>();
  kind = input<'image' | 'video' | 'all'>();
  personId = input<string>();
  // Token of an ordered id list in ViewerSequence (search results), so the
  // viewer's prev / next walks that list.
  seq = input<string>();

  protected readonly justified = computed(() => this.cell?.justified() ?? false);

  protected readonly selected = computed(
    () => !!this.selection && this.selection.ids().has(this.asset().id),
  );

  protected readonly smallUrl = computed(() => `${this.apiUrl}/asset/${this.asset().id}/thumbnail`);
  protected readonly largeUrl = computed(
    () => `${this.apiUrl}/asset/${this.asset().id}/thumbnail_lg`,
  );

  // The browser picks 320w or 640w from this and the screen density.
  protected readonly sizes = computed(() => {
    const w = this.cell?.tileWidth() ?? 0;
    return w > 0 ? `${Math.round(w)}px` : '(max-width: 640px) 34vw, 240px';
  });

  protected readonly alt = computed(() => {
    const a = this.asset();
    const kind = a.type === 'video' ? 'Video' : 'Photo';
    const raw = a.takenAt;
    if (!raw) return kind;
    const d = raw instanceof Date ? raw : new Date(raw);
    return Number.isNaN(d.getTime()) ? kind : `${kind}, ${altDate.format(d)}`;
  });

  private readonly queryParams = computed(() => {
    const params: Record<string, string | undefined> = {
      from: this.from(),
      albumId: this.albumId(),
      cameraMake: this.cameraMake(),
      cameraModel: this.cameraModel(),
      kind: this.kind(),
      personId: this.personId(),
      seq: this.seq(),
    };
    return Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined));
  });

  protected readonly href = computed(() =>
    this.router.serializeUrl(
      this.router.createUrlTree(['/asset', this.asset().id], { queryParams: this.queryParams() }),
    ),
  );

  private pressTimer: ReturnType<typeof setTimeout> | null = null;
  private pressStart: { x: number; y: number } | null = null;
  private longPressed = false;

  onImageLoad(): void {
    this.imageLoaded.set(true);
  }

  protected onClick(event: MouseEvent): void {
    const sel = this.selection;
    const id = this.asset().id;

    // Cmd/Ctrl-click and middle-click open a new tab as usual.
    if (event.metaKey || event.ctrlKey || event.button !== 0) return;
    event.preventDefault();

    if (sel) {
      if (sel.consumeSuppressedClick() || this.longPressed) {
        this.longPressed = false;
        return;
      }
      if (event.shiftKey && sel.active()) {
        sel.selectRangeTo(id);
        return;
      }
      if (sel.active()) {
        sel.toggle(id);
        return;
      }
    }
    this.router.navigate(['/asset', id], { queryParams: this.queryParams() });
  }

  protected onCheckClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const sel = this.selection;
    if (!sel || sel.consumeSuppressedClick()) return;
    const id = this.asset().id;
    if (event.shiftKey && sel.active() && sel.hasAnchor()) sel.selectRangeTo(id);
    else sel.toggle(id);
  }

  protected onKeydown(event: KeyboardEvent): void {
    // Space selects the focused tile; Enter opens it, also in select mode
    // (the browser turns Enter on a link into a click, which would toggle).
    if (event.key === 'Enter' && this.selection?.active()) {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      this.router.navigate(['/asset', this.asset().id], { queryParams: this.queryParams() });
      return;
    }
    if (event.key === ' ' && this.selection) {
      event.preventDefault();
      if (event.shiftKey && this.selection.active()) this.selection.selectRangeTo(this.asset().id);
      else this.selection.toggle(this.asset().id);
    }
  }

  // Long-press on touch enters select mode (Google Photos style).
  protected onPointerDown(event: PointerEvent): void {
    if (!this.selection || event.pointerType !== 'touch') return;
    this.cancelPress();
    this.longPressed = false;
    this.pressStart = { x: event.clientX, y: event.clientY };
    this.pressTimer = setTimeout(() => {
      this.pressTimer = null;
      this.longPressed = true;
      const sel = this.selection!;
      const id = this.asset().id;
      if (!sel.isSelected(id)) sel.toggle(id);
      else sel.setAnchor(id);
      sel.suppressNextClick(800);
      try {
        navigator.vibrate?.(10);
      } catch {
        // Not supported: fine.
      }
    }, LONG_PRESS_MS);
  }

  protected onPointerMove(event: PointerEvent): void {
    if (!this.pressTimer || !this.pressStart) return;
    const dx = event.clientX - this.pressStart.x;
    const dy = event.clientY - this.pressStart.y;
    if (dx * dx + dy * dy > LONG_PRESS_SLOP_PX * LONG_PRESS_SLOP_PX) this.cancelPress();
  }

  protected cancelPress(): void {
    if (this.pressTimer) clearTimeout(this.pressTimer);
    this.pressTimer = null;
    this.pressStart = null;
  }

  protected onContextMenu(event: Event): void {
    // Android opens the link menu on long-press; select mode replaces it.
    if (this.selection && (this.longPressed || this.pressTimer)) event.preventDefault();
  }

  onHover(): void {
    const a = this.asset();
    this.prefetch.prefetchAsset(a.id, {
      albumId: this.albumId(),
      cameraMake: this.cameraMake(),
      cameraModel: this.cameraModel(),
      kind: this.kind(),
      personId: this.personId(),
    });
  }

  onHoverEnd(): void {
    this.prefetch.cancelPrefetchAsset(this.asset().id);
  }

  ngOnDestroy(): void {
    this.cancelPress();
  }
}
