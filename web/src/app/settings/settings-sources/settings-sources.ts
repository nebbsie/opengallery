import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { ErrorAlert } from '@core/components/error/error';
import { Confirm } from '@core/dialogs/confirm/confirm';
import { PathSelect } from '@core/dialogs/path-select/path-select';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc, RouterOutputs } from '@core/services/trpc';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleHelp, lucideTrash2 } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCheckbox } from '@spartan-ng/helm/checkbox';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';

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
      <h1 class="text-foreground mb-2 block text-lg font-bold">Folder Settings</h1>
      <p class="text-muted-foreground mb-6 text-sm">
        Specify how the application should handle scanning and importing media from the specified
        folders.
      </p>

      <label class="hover:bg-accent/50 mb-10 flex max-w-lg items-start gap-3 rounded-lg border p-3">
        <hlm-checkbox
          id="toggle-2"
          [checked]="importAlbums()"
          (changed)="clickedImportAlbums($event)"
        />
        <div class="grid gap-1.5 font-normal">
          <p class="text-sm leading-none font-bold">Import Albums</p>
          <p class="text-muted-foreground text-sm">
            Automatically import your media into albums based on folder structure.
          </p>
        </div>
      </label>

      <h1 class="text-foreground mb-2 block text-lg font-bold">Source Folders</h1>

      <p class="text-muted-foreground mb-6 text-sm">
        Specify the locations of the existing media you have. These will be ingested, the raw files
        will not be moved or modified.
      </p>

      @for (path of items(); track path.id) {
        <div class="mb-4 flex max-w-lg gap-x-2">
          <input [formControl]="path.control" hlmInput type="email" placeholder="Email" />

          <button
            class="text-foreground"
            hlmBtn
            variant="ghost"
            size="icon"
            (click)="handleDeleteSource(path.id)"
          >
            <ng-icon hlm size="sm" name="lucideTrash2" />
          </button>
        </div>
      }

      <button class="mb-10" hlmBtn variant="outline" (click)="addPath()">Add Another Path</button>
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
      this.queryClient.setQueryData<MediaSourceSettings>(
        [CacheKey.MediaSourcesSettings],
        (old: MediaSourceSettings | undefined): MediaSourceSettings | undefined =>
          old
            ? {
                ...old,
                paths: [
                  ...old.paths,
                  {
                    id: tempId,
                    path,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    userId: 'temp-id',
                  },
                ],
              }
            : old,
      );

      return { previous, tempId };
    },
    onSuccess: (created, path, ctx) => {
      // If the mutation succeeds, replace the temporary path with the created path.
      this.queryClient.setQueryData<MediaSourceSettings>(
        [CacheKey.MediaSourcesSettings],
        (old: MediaSourceSettings | undefined): MediaSourceSettings | undefined =>
          old
            ? {
                ...old,
                paths: old.paths.map((p: MediaSourceSettings['paths'][number]) =>
                  p.id === ctx?.tempId ? created : p,
                ),
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
        (old: MediaSourceSettings): MediaSourceSettings => ({
          ...old,
          paths: old.paths.filter((p: MediaSourceSettings['paths'][number]) => p.id !== item),
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

    return res.paths.map((path: MediaSourceSettings['paths'][number]) => ({
      id: path.id,
      control: new FormControl<string | null>({ value: path.path, disabled: true }, [
        Validators.required,
      ]),
    }));
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
    this.dialog.open(PathSelect).closed$.subscribe((path: string | null) => {
      if (path) {
        this.addSource.mutate(path);
      }
    });
  }

  clickedImportAlbums(checked: boolean) {
    this.trpc.mediaSourcesSettings.updateSettings.mutate({ autoImportAlbums: checked });
  }

  handleDeleteSource(id: string) {
    this.dialog
      .open(Confirm, {
        context: {
          message: 'You will no longer track and show media from this source if deleted.',
        },
      })
      .closed$.subscribe((res: boolean) => {
        if (res) {
          this.deleteSource.mutate(id);
        }
      });
  }
}
