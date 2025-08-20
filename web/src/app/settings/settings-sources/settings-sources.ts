import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { injectTrpcClient } from '@core/services/trpc';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideTrash2, lucideCircleHelp } from '@ng-icons/lucide';
import { FormArray, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmCheckbox } from '@spartan-ng/helm/checkbox';

@Component({
  selector: 'app-settings-sources',
  providers: [provideIcons({ lucideTrash2, lucideCircleHelp })],
  imports: [ReactiveFormsModule, HlmButton, HlmIcon, NgIcon, HlmInput, HlmCheckbox],
  host: {
    class: 'w-full',
  },
  template: `
    <h1 class="text-foreground mb-2 block text-lg font-bold">Source Folders</h1>

    <p class="text-muted mb-6 text-sm font-light">
      Specify the folders where your media files are stored. The application will scan these
      locations to import your photos and videos.
    </p>

    @for (control of pathsControlArray.controls; track $index) {
      <div class="mb-4 flex max-w-lg gap-x-2">
        <input [formControl]="control" hlmInput type="text" placeholder="e.g. /storage/Photos" />

        @if ($index !== 0) {
          <button
            class="text-foreground ml-auto"
            hlmBtn
            variant="ghost"
            size="sm"
            (click)="removeInput($index)"
          >
            <ng-icon hlm size="sm" name="lucideTrash2" />
          </button>
        }
      </div>
    }

    <button class="mb-10" hlmBtn variant="outline" (click)="addPath()">Add Another Path</button>

    <h1 class="text-foreground mb-2 block text-lg font-bold">Folder Settings</h1>
    <p class="text-muted mb-6 text-sm font-light">
      Specify how the application should handle scanning and importing media from the specified
      folders.
    </p>

    <label class="hover:bg-accent/50 mb-10 flex max-w-lg items-start gap-3 rounded-lg border p-3">
      <hlm-checkbox id="toggle-2" [checked]="importAlbums" (changed)="importAlbums = $event" />
      <div class="grid gap-1.5 font-normal">
        <p class="text-sm leading-none font-bold">Import Albums</p>
        <p class="text-muted-foreground text-sm font-light">
          Automatically import your media into albums based on folder structure.
        </p>
      </div>
    </label>

    <button hlmBtn size="sm" (click)="saveChanges()">Save Changes</button>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsSources {
  private trpc = injectTrpcClient();

  importAlbums = false;

  pathsControlArray = new FormArray([new FormControl<string | null>(null, [Validators.required])]);

  addPath(): void {
    this.pathsControlArray.push(new FormControl<string | null>(null, [Validators.required]));
  }

  removeInput(index: number) {
    if (this.pathsControlArray.length > 1) {
      this.pathsControlArray.removeAt(index);
    }
  }

  saveChanges() {
    const nonBlankPaths = this.pathsControlArray.value.filter(
      (value) => value && value.trim() !== '',
    );

    this.pathsControlArray.markAllAsTouched();

    if (nonBlankPaths.length === 0) {
      console.log('No valid paths to save');
      return;
    }

    console.log('Save');
  }
}
