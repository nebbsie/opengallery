import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  input,
  OnInit,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { PickerPerson } from '@core/components/people-picker/people-picker';
import { PluralPipe } from '@core/pipes/plural.pipe';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { environment } from '@env/environment';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideUser } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmInput } from '@spartan-ng/helm/input';
import { injectQuery } from '@tanstack/angular-query-experimental';

let nextId = 0;

// Admin "Add a name" field with autocomplete against the people who already
// have a name. Picking (or typing) an existing name asks to merge into that
// person instead of making a second person with the same name.
@Component({
  selector: 'app-name-input',
  imports: [HlmInput, HlmButton, NgIcon, HlmIcon, PluralPipe],
  providers: [provideIcons({ lucideUser })],
  host: { class: 'relative block' },
  template: `
    @if (confirmTarget(); as t) {
      <div
        class="glass-strong text-popover-foreground flex flex-col gap-2 rounded-xl p-2 text-left"
        role="group"
        [attr.aria-label]="'Merge into ' + t.name"
        (keydown.escape)="$event.preventDefault(); $event.stopPropagation(); backToInput()"
      >
        <p class="text-sm text-pretty">
          Already have <strong>{{ t.name }}</strong>. Merge into that person?
        </p>
        <div class="flex gap-2">
          <button
            #mergeBtn
            hlmBtn
            size="sm"
            class="h-11 flex-1 active:scale-[0.96] sm:h-8"
            (click)="confirmMerge(t)"
          >
            Merge
          </button>
          <button
            hlmBtn
            size="sm"
            variant="ghost"
            class="h-11 active:scale-[0.96] sm:h-8"
            (click)="backToInput()"
          >
            Back
          </button>
        </div>
      </div>
    } @else {
      <input
        #field
        hlmInput
        role="combobox"
        autocomplete="off"
        aria-autocomplete="list"
        [attr.aria-expanded]="open()"
        [attr.aria-controls]="listId"
        [attr.aria-activedescendant]="active() >= 0 ? listId + '-' + active() : null"
        [attr.aria-label]="label()"
        [class]="inputClass()"
        [value]="draft()"
        placeholder="Add a name"
        (input)="onInput($any($event.target).value)"
        (keydown)="onKey($event)"
        (blur)="onBlur()"
      />
      @if (open()) {
        <ul
          [id]="listId"
          role="listbox"
          [attr.aria-label]="'People named like ' + draft()"
          class="glass-strong text-popover-foreground absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-xl p-1 text-left"
        >
          @for (p of matches(); track p.id; let i = $index) {
            <li
              [id]="listId + '-' + i"
              role="option"
              [attr.aria-selected]="i === active()"
              class="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-sm"
              [class.bg-accent]="i === active()"
              (mousedown)="$event.preventDefault()"
              (mouseenter)="active.set(i)"
              (click)="pick(p)"
            >
              <span class="bg-muted relative size-8 shrink-0 overflow-hidden rounded-full">
                @if (p.coverFaceId) {
                  <img class="h-full w-full object-cover" [src]="faceUrl(p.coverFaceId)" alt="" />
                } @else {
                  <span class="text-muted-foreground grid h-full w-full place-items-center">
                    <ng-icon hlm size="xs" name="lucideUser" />
                  </span>
                }
              </span>
              <span class="min-w-0 flex-1 truncate">{{ p.name }}</span>
              <span class="text-muted-foreground shrink-0 text-xs tabular-nums">
                {{ p.faceCount | plural: 'photo' }}
              </span>
            </li>
          }
        </ul>
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NameInput implements OnInit {
  readonly initial = input<string | null>(null);
  // The person being named; left out of the suggestions.
  readonly personId = input.required<string>();
  readonly large = input(false);
  readonly label = input('Name this person');

  // A new name (null clears it). Emitted on Enter or blur.
  readonly saved = output<string | null>();
  // The admin chose to merge this person into an existing named person.
  readonly merge = output<PickerPerson>();
  readonly cancelled = output<void>();

  private readonly trpc = injectTrpc();
  private readonly apiUrl = environment.api.url;
  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');
  private readonly mergeBtn = viewChild<ElementRef<HTMLButtonElement>>('mergeBtn');
  protected readonly listId = `name-input-${nextId++}`;

  protected readonly draft = signal('');
  protected readonly active = signal(-1);
  protected readonly confirmTarget = signal<PickerPerson | null>(null);
  private done = false;

  // Shares the cache entry with the person page's merge list.
  private readonly people = injectQuery(() => ({
    queryKey: [CacheKey.FacesAll, 'merge-targets'],
    queryFn: async () => this.trpc.faces.listPeople.query({ includeHidden: true }),
    staleTime: 30_000,
  }));

  private readonly named = computed(() =>
    ((this.people.data() ?? []) as PickerPerson[]).filter(
      (p) => !!p.name && p.id !== this.personId(),
    ),
  );

  protected readonly matches = computed(() => {
    const q = this.draft().trim().toLowerCase();
    if (!q) return [];
    const starts: PickerPerson[] = [];
    const contains: PickerPerson[] = [];
    for (const p of this.named()) {
      const n = p.name!.toLowerCase();
      if (n.startsWith(q)) starts.push(p);
      else if (n.includes(q)) contains.push(p);
    }
    return [...starts, ...contains].slice(0, 6);
  });

  protected readonly open = computed(() => this.matches().length > 0);

  protected readonly inputClass = computed(() =>
    this.large() ? 'h-11 w-full text-xl font-bold' : 'h-11 w-full text-center text-sm sm:h-9',
  );

  ngOnInit(): void {
    this.draft.set(this.initial() ?? '');
  }

  constructor() {
    afterNextRender(() => {
      const el = this.field()?.nativeElement;
      el?.focus();
      el?.select();
    });
  }

  protected faceUrl(faceId: string): string {
    return `${this.apiUrl}/face/${faceId}`;
  }

  protected onInput(value: string): void {
    this.draft.set(value);
    this.active.set(-1);
  }

  protected onKey(e: KeyboardEvent): void {
    const list = this.matches();
    if (e.key === 'ArrowDown' && list.length > 0) {
      e.preventDefault();
      this.active.update((i) => (i + 1) % list.length);
    } else if (e.key === 'ArrowUp' && list.length > 0) {
      e.preventDefault();
      this.active.update((i) => (i <= 0 ? list.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const chosen = list[this.active()];
      if (chosen) this.pick(chosen);
      else this.commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.finish(() => this.cancelled.emit());
    }
  }

  protected onBlur(): void {
    // A pending merge question keeps the field open; it has its own buttons.
    if (this.confirmTarget()) return;
    this.commit();
  }

  protected pick(p: PickerPerson): void {
    this.confirmTarget.set(p);
    afterFrame(() => this.mergeBtn()?.nativeElement.focus());
  }

  protected backToInput(): void {
    this.confirmTarget.set(null);
    afterFrame(() => this.field()?.nativeElement.focus());
  }

  protected confirmMerge(p: PickerPerson): void {
    this.finish(() => this.merge.emit(p));
  }

  // Save the typed name. An exact match of an existing name asks to merge.
  private commit(): void {
    const name = this.draft().trim();
    const same = name
      ? this.named().find((p) => p.name!.toLowerCase() === name.toLowerCase())
      : undefined;
    if (same) {
      this.pick(same);
      return;
    }
    if (name === (this.initial() ?? '')) {
      this.finish(() => this.cancelled.emit());
      return;
    }
    this.finish(() => this.saved.emit(name.length > 0 ? name : null));
  }

  private finish(emit: () => void): void {
    if (this.done) return;
    this.done = true;
    emit();
  }
}

function afterFrame(fn: () => void): void {
  if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(fn);
}
