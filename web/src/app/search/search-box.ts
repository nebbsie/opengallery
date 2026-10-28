import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { injectTrpc } from '@core/services/trpc';
import { environment } from '@env/environment';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCalendar,
  lucideCamera,
  lucideHistory,
  lucideImages,
  lucideMapPin,
  lucideSearch,
  lucideX,
} from '@ng-icons/lucide';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { injectQuery, keepPreviousData } from '@tanstack/angular-query-experimental';
import { debounceTime, distinctUntilChanged, map } from 'rxjs';
import { SearchState, searchLinks } from './search-state';

type OptionKind = 'search' | 'recent' | 'person' | 'album' | 'place' | 'camera' | 'date';

type Option = {
  id: string;
  kind: OptionKind;
  label: string;
  sublabel?: string;
  image?: string | null;
  icon: string;
  round?: boolean;
  commands?: unknown[];
  query?: string;
};

type Section = { title: string | null; options: Option[] };

let nextId = 0;

// Search field with a suggestion dropdown (ARIA combobox). Typing is debounced
// before suggestions load. Arrow keys move through the suggestions, Enter opens
// the active one, or runs a full search on /search?q= when none is active.
@Component({
  selector: 'app-search-box',
  imports: [NgIcon, HlmIcon, HlmSpinner],
  providers: [
    provideIcons({
      lucideSearch,
      lucideX,
      lucideHistory,
      lucideImages,
      lucideMapPin,
      lucideCamera,
      lucideCalendar,
    }),
  ],
  host: { class: 'relative block' },
  template: `
    <div
      class="bg-glass-tint-strong focus-within:bg-background/80 focus-within:ring-ring/50 flex h-11 items-center gap-2 rounded-full px-4 transition-[background-color,box-shadow] duration-150 focus-within:shadow-sm focus-within:ring-2"
    >
      <ng-icon hlm size="sm" name="lucideSearch" class="text-muted-foreground shrink-0" />
      <input
        #field
        type="search"
        role="combobox"
        aria-autocomplete="list"
        [attr.aria-label]="'Search your photos'"
        [attr.aria-expanded]="showList()"
        [attr.aria-controls]="listId"
        [attr.aria-activedescendant]="activeOption()?.id ?? null"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        enterkeyhint="search"
        placeholder="Search people, places, albums, years"
        class="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-base outline-none sm:text-sm [&::-webkit-search-cancel-button]:hidden"
        [value]="text()"
        (input)="onInput($event)"
        (keydown)="onKeydown($event)"
        (focus)="focused.set(true)"
        (blur)="focused.set(false)"
      />
      @if (suggest.isFetching() && debounced()) {
        <hlm-spinner class="size-4 shrink-0" />
      }
      @if (text()) {
        <button
          type="button"
          aria-label="Clear search"
          class="text-muted-foreground hover:text-foreground -mr-2 grid size-9 shrink-0 place-items-center rounded-full transition-[color,scale] duration-100 active:scale-[0.96]"
          (mousedown)="$event.preventDefault()"
          (click)="clear()"
        >
          <ng-icon hlm size="sm" name="lucideX" />
        </button>
      }
    </div>

    @if (showList()) {
      <div
        [id]="listId"
        role="listbox"
        aria-label="Search suggestions"
        class="text-popover-foreground z-50 overflow-y-auto overscroll-contain py-2"
        [class]="
          inline()
            ? 'mt-2 max-h-[min(60vh,28rem)]'
            : 'glass-strong absolute top-full right-0 left-0 mt-2 max-h-[min(70vh,32rem)] rounded-2xl'
        "
        (mousedown)="$event.preventDefault()"
      >
        @for (section of sections(); track $index) {
          @if (section.title) {
            <p class="text-muted-foreground px-4 pt-2 pb-1 text-xs font-medium">
              {{ section.title }}
            </p>
          }
          @for (option of section.options; track option.id) {
            <div
              role="option"
              [id]="option.id"
              [attr.aria-selected]="activeOption()?.id === option.id"
              class="flex min-h-11 cursor-pointer items-center gap-3 px-4 py-1.5 text-sm"
              [class.bg-accent]="activeOption()?.id === option.id"
              (mouseenter)="activeIndex.set(indexOf(option))"
              (click)="choose(option)"
            >
              @if (option.image) {
                <img
                  [src]="option.image"
                  alt=""
                  class="size-8 shrink-0 object-cover outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
                  [class.rounded-full]="option.round"
                  [class.rounded-md]="!option.round"
                  loading="lazy"
                />
              } @else {
                <span
                  class="bg-muted text-muted-foreground grid size-8 shrink-0 place-items-center"
                  [class.rounded-full]="option.round"
                  [class.rounded-md]="!option.round"
                >
                  <ng-icon hlm size="sm" [name]="option.icon" />
                </span>
              }
              <span class="min-w-0 flex-1">
                <span class="block truncate">{{ option.label }}</span>
                @if (option.sublabel) {
                  <span class="text-muted-foreground block truncate text-xs tabular-nums">{{
                    option.sublabel
                  }}</span>
                }
              </span>
              @if (option.kind === 'recent') {
                <button
                  type="button"
                  class="text-muted-foreground hover:text-foreground -mr-2 grid size-8 place-items-center rounded-full"
                  [attr.aria-label]="'Remove ' + option.label + ' from recent searches'"
                  (click)="$event.stopPropagation(); state.forget(option.label)"
                >
                  <ng-icon hlm size="xs" name="lucideX" />
                </button>
              }
            </div>
          }
        }
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchBox {
  private readonly trpc = injectTrpc();
  private readonly router = inject(Router);
  protected readonly state = inject(SearchState);
  private readonly apiUrl = environment.api.url;

  // The query to show when the box first renders or when the URL changes.
  readonly value = input('');
  // Render the list in flow (in the palette) instead of as a floating dropdown.
  readonly inline = input(false);
  readonly autofocus = input(false);
  // Fired after the box navigates anywhere (palette closes on this).
  readonly navigated = output<void>();
  // Fired on Escape with an empty or closed list.
  readonly escaped = output<void>();

  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');

  protected readonly listId = `search-list-${nextId++}`;
  protected readonly text = signal('');
  protected readonly focused = signal(false);
  protected readonly activeIndex = signal(-1);
  // The list hides after a choice until the user types again.
  private readonly dismissed = signal(false);

  protected readonly debounced = toSignal(
    toObservable(this.text).pipe(
      map((t) => t.trim()),
      debounceTime(150),
      distinctUntilChanged(),
    ),
    { initialValue: '' },
  );

  protected readonly suggest = injectQuery(() => ({
    queryKey: ['search', 'suggest', this.debounced()],
    queryFn: () => this.trpc.search.suggest.query({ q: this.debounced(), limit: 5 }),
    enabled: this.debounced().length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  }));

  protected readonly sections = computed<Section[]>(() => {
    const q = this.text().trim();
    if (!q) {
      const recent = this.state.recent();
      return recent.length
        ? [
            {
              title: 'Recent searches',
              options: recent.map((r, i) => ({
                id: `${this.listId}-recent-${i}`,
                kind: 'recent' as const,
                label: r,
                icon: 'lucideHistory',
                round: true,
                query: r,
              })),
            },
          ]
        : [];
    }

    const sections: Section[] = [
      {
        title: null,
        options: [
          {
            id: `${this.listId}-search`,
            kind: 'search',
            label: `Search for "${q}"`,
            icon: 'lucideSearch',
            round: true,
            query: q,
          },
        ],
      },
    ];
    // Only show groups for the text that the results belong to, so stale
    // results from an older query never sit under a new one for long.
    const data = this.suggest.data();
    if (!data) return sections;

    if (data.people.length) {
      sections.push({
        title: 'People',
        options: data.people.map((p) => ({
          id: `${this.listId}-person-${p.id}`,
          kind: 'person' as const,
          label: p.name,
          sublabel: countLabel(p.count, 'photo'),
          image: p.coverFaceId ? `${this.apiUrl}/face/${p.coverFaceId}` : null,
          icon: 'lucideSearch',
          round: true,
          commands: searchLinks.person(p.id),
        })),
      });
    }
    if (data.places.length) {
      sections.push({
        title: 'Places',
        options: data.places.map((p) => ({
          id: `${this.listId}-place-${p.name}`,
          kind: 'place' as const,
          label: p.name,
          sublabel: `${p.country} · ${countLabel(p.count, 'item')}`,
          image: p.cover ? `${this.apiUrl}/asset/${p.cover}/thumbnail` : null,
          icon: 'lucideMapPin',
          commands: searchLinks.place(p.lat, p.lon),
        })),
      });
    }
    if (data.albums.length) {
      sections.push({
        title: 'Albums',
        options: data.albums.map((a) => ({
          id: `${this.listId}-album-${a.id}`,
          kind: 'album' as const,
          label: a.name,
          sublabel: countLabel(a.items, 'item'),
          image: a.cover ? `${this.apiUrl}/asset/${a.cover}/thumbnail` : null,
          icon: 'lucideImages',
          commands: searchLinks.album(a.id),
        })),
      });
    }
    if (data.cameras.length) {
      sections.push({
        title: 'Cameras',
        options: data.cameras.map((c) => ({
          id: `${this.listId}-camera-${c.make}-${c.model}`,
          kind: 'camera' as const,
          label: `${c.make} ${c.model}`,
          sublabel: countLabel(c.count, 'photo'),
          icon: 'lucideCamera',
          commands: searchLinks.camera(c.make, c.model),
        })),
      });
    }
    if (data.dates.length) {
      sections.push({
        title: 'Dates',
        options: data.dates.map((d) => ({
          id: `${this.listId}-date-${d.label}`,
          kind: 'date' as const,
          label: d.label,
          icon: 'lucideCalendar',
          // A bare year opens the year page; a month runs a search.
          ...(d.year !== null && d.month === null
            ? { commands: searchLinks.year(d.year) }
            : { query: d.label }),
        })),
      });
    }
    return sections;
  });

  protected readonly options = computed(() => this.sections().flatMap((s) => s.options));
  protected readonly activeOption = computed<Option | null>(
    () => this.options()[this.activeIndex()] ?? null,
  );
  protected readonly showList = computed(
    () => this.focused() && !this.dismissed() && this.options().length > 0,
  );

  constructor() {
    // Follow the URL (back/forward, links) without fighting the user's typing.
    effect(() => {
      const v = this.value();
      untracked(() => {
        this.text.set(v);
        this.dismissed.set(true);
      });
    });
    effect(() => {
      if (this.autofocus()) queueMicrotask(() => this.focus());
    });
    // Keep the highlight in range when the list changes.
    effect(() => {
      const count = this.options().length;
      untracked(() => {
        if (this.activeIndex() >= count) this.activeIndex.set(-1);
      });
    });
  }

  focus() {
    const el = this.field().nativeElement;
    el.focus();
    el.select();
    this.dismissed.set(false);
  }

  protected indexOf(option: Option) {
    return this.options().indexOf(option);
  }

  protected onInput(event: Event) {
    this.text.set((event.target as HTMLInputElement).value);
    this.activeIndex.set(-1);
    this.dismissed.set(false);
  }

  protected clear() {
    this.text.set('');
    this.activeIndex.set(-1);
    this.dismissed.set(false);
    this.field().nativeElement.focus();
  }

  protected onKeydown(event: KeyboardEvent) {
    const count = this.options().length;
    switch (event.key) {
      case 'ArrowDown':
        if (!count) return;
        event.preventDefault();
        this.dismissed.set(false);
        this.activeIndex.set((this.activeIndex() + 1) % count);
        this.scrollActiveIntoView();
        return;
      case 'ArrowUp':
        if (!count) return;
        event.preventDefault();
        this.dismissed.set(false);
        this.activeIndex.set(this.activeIndex() <= 0 ? count - 1 : this.activeIndex() - 1);
        this.scrollActiveIntoView();
        return;
      case 'Enter': {
        event.preventDefault();
        const active = this.showList() ? this.activeOption() : null;
        if (active) {
          this.choose(active);
        } else {
          this.runSearch(this.text());
        }
        return;
      }
      case 'Escape':
        if (this.showList() && this.activeIndex() >= 0) {
          event.preventDefault();
          this.activeIndex.set(-1);
        } else if (this.showList()) {
          event.preventDefault();
          this.dismissed.set(true);
        } else {
          this.escaped.emit();
        }
        return;
    }
  }

  protected choose(option: Option) {
    if (option.commands) {
      this.state.remember(this.text());
      this.dismissed.set(true);
      this.field().nativeElement.blur();
      void this.router.navigate(option.commands);
      this.navigated.emit();
      return;
    }
    if (option.query) this.runSearch(option.query);
  }

  private runSearch(raw: string) {
    const q = raw.trim();
    if (!q) return;
    this.text.set(q);
    this.state.remember(q);
    this.dismissed.set(true);
    this.activeIndex.set(-1);
    this.field().nativeElement.blur();
    void this.router.navigate(['/search'], { queryParams: { q } });
    this.navigated.emit();
  }

  private scrollActiveIntoView() {
    const id = this.activeOption()?.id;
    if (!id) return;
    queueMicrotask(() => document.getElementById(id)?.scrollIntoView({ block: 'nearest' }));
  }
}

function countLabel(n: number, singular: string): string {
  return `${n.toLocaleString()} ${n === 1 ? singular : `${singular}s`}`;
}
