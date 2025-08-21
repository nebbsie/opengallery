import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { injectTrpc, RouterOutputs } from '@core/services/trpc';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideTrash2, lucideCircleHelp } from '@ng-icons/lucide';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmCheckbox } from '@spartan-ng/helm/checkbox';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { ErrorAlert } from '@core/components/error/error';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { CacheKey } from '@core/services/cache-key.types';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { PathSelect } from '@core/dialogs/path-select/path-select';

type MediaSourceSettings = RouterOutputs['mediaSourcesSettings']['get'];

@Component({
  selector: 'app-settings-sources',
  providers: [provideIcons({ lucideTrash2, lucideCircleHelp })],
  imports: [
    ReactiveFormsModule,
    HlmButton,
    HlmIcon,
    NgIcon,
    HlmInput,
    HlmCheckbox,
    ErrorAlert,
    HlmSpinner,
  ],
  host: {
    class: 'w-full',
  },
  template: `
    @if (settings.isPending()) {
      <hlm-spinner />
    }

    @if (settings.isError()) {
      <app-error-alert [error]="settings.error()" />
    }

    @if (settings.isSuccess()) {
      <h1 class="text-foreground mb-2 block text-lg font-bold">Source Folders</h1>

      <p class="text-muted-foreground mb-6 text-sm">
        Specify the folders where your media files are stored. The application will scan these
        locations to import your photos and videos.
      </p>

      @for (path of items(); track path.id) {
        <div class="mb-4 flex max-w-lg gap-x-2">
          <input [formControl]="path.control" hlmInput type="email" placeholder="Email" />

          <button
            class="text-foreground"
            hlmBtn
            variant="ghost"
            size="icon"
            (click)="deleteSource.mutate(path.id)"
          >
            <ng-icon hlm size="sm" name="lucideTrash2" />
          </button>
        </div>
      }

      <button class="mb-10" hlmBtn variant="outline" (click)="addPath()">Add Another Path</button>

      <h1 class="text-foreground mb-2 block text-lg font-bold">Folder Settings</h1>
      <p class="text-muted-foreground mb-6 text-sm">
        Specify how the application should handle scanning and importing media from the specified
        folders.
      </p>

      <label class="hover:bg-accent/50 mb-10 flex max-w-lg items-start gap-3 rounded-lg border p-3">
        <hlm-checkbox id="toggle-2" [(checked)]="importAlbums" />
        <div class="grid gap-1.5 font-normal">
          <p class="text-sm leading-none font-bold">Import Albums</p>
          <p class="text-muted-foreground text-sm">
            Automatically import your media into albums based on folder structure.
          </p>
        </div>
      </label>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsSources {
  private trpc = injectTrpc();
  private queryClient = inject(QueryClient);
  private dialog = inject(HlmDialogService);

  settings = injectQuery(() => ({
    queryKey: [CacheKey.MediaSourcesSettings],
    queryFn: async () => this.trpc.mediaSourcesSettings.get.query(),
    retryDelay: 0,
  }));

  addSource = injectMutation(() => ({
    mutationFn: (path: string) => this.trpc.mediaSourcesSettings.createSource.mutate(path),
    onMutate: async (path) => {
      // Stop ongoing queries for the media sources settings.
      await this.queryClient.cancelQueries({ queryKey: [CacheKey.MediaSourcesSettings] });

      // Get the previous state of the media sources settings.
      const previous = this.queryClient.getQueryData<MediaSourceSettings>([
        CacheKey.MediaSourcesSettings,
      ]);

      // Optimistically update the cache to add a temporary path.
      // This will be replaced with the actual path once the mutation succeeds.
      // We use a temporary ID to avoid conflicts with existing paths.
      const tempId = `temp-${Date.now()}`;
      this.queryClient.setQueryData<MediaSourceSettings>([CacheKey.MediaSourcesSettings], (old) =>
        old
          ? {
              ...old,
              paths: [
                {
                  id: tempId,
                  path,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                },
                ...old.paths,
              ],
            }
          : old,
      );

      return { previous, tempId };
    },
    onSuccess: (created, path, ctx) => {
      // If the mutation succeeds, replace the temporary path with the created path.
      this.queryClient.setQueryData<MediaSourceSettings>([CacheKey.MediaSourcesSettings], (old) =>
        old
          ? {
              ...old,
              paths: old.paths.map((p) => (p.id === ctx?.tempId ? created : p)),
            }
          : old,
      );
    },
    onError: (error, _, ctx) => {
      // If an error occurs, roll back to the previous state.
      this.queryClient.setQueryData([CacheKey.MediaSourcesSettings], ctx?.previous);
    },
  }));

  deleteSource = injectMutation(() => ({
    mutationFn: (id: string) => this.trpc.mediaSourcesSettings.deleteSource.mutate(id),
    onMutate: async (item) => {
      // Stop ongoing queries for the media sources settings.
      await this.queryClient.cancelQueries({ queryKey: [CacheKey.MediaSourcesSettings] });

      // Get the previous state of the media sources settings.
      // This is used to roll back in case of an error.
      const previous = this.queryClient.getQueryData<MediaSourceSettings>([
        CacheKey.MediaSourcesSettings,
      ]);

      // Optimistically update the cache to remove the deleted item.
      this.queryClient.setQueryData(
        [CacheKey.MediaSourcesSettings],
        (old: MediaSourceSettings) => ({
          ...old,
          paths: old.paths.filter((p) => p.id !== item),
        }),
      );

      // Return the previous state so we can roll back if needed.
      return { previous };
    },
    onError: (err, deletedId, context) => {
      // If an error occurs, roll back to the previous state.
      this.queryClient.setQueryData([CacheKey.MediaSourcesSettings], context?.previous);
    },
  }));

  items = computed(() => {
    const res = this.settings.data();
    if (!res) {
      return [];
    }

    const vals = [];
    for (const p of res.paths) {
      vals.push({
        id: p.id,
        control: new FormControl<string | null>({ value: p.path, disabled: true }, [
          Validators.required,
        ]),
      });
    }

    return vals;
  });

  importAlbums = signal(false);

  constructor() {
    effect(() => {
      const data = this.settings.data();
      if (data) {
        this.importAlbums.set(data.autoImportAlbums);
      }
    });
  }

  addPath() {
    this.dialog.open(PathSelect).closed$.subscribe((path) => {
      if (path) {
        this.addSource.mutate(path);
      }
    });
  }
}
