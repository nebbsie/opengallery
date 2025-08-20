import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FormArray, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmCheckbox } from '@spartan-ng/helm/checkbox';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideTrash2 } from '@ng-icons/lucide';
import { HlmLabel } from '@spartan-ng/helm/label';

@Component({
  selector: 'app-setup',
  providers: [provideIcons({ lucideTrash2 })],
  imports: [ReactiveFormsModule, HlmButton, HlmIcon, NgIcon, HlmCheckbox, HlmLabel],
  template: `
    <div class="mx-auto max-w-3xl">
      <h1 class="text-foreground mb-10 block text-lg font-bold">External Library Management</h1>

      <label class="text-foreground mb-2 block text-sm font-bold" for="library-path">
        Library Path(s)
      </label>

      @for (control of libraryPathsArray.controls; track $index) {
        <div class="flex gap-x-2">
          <input
            [formControl]="control"
            class="focus:shadow-outline bg-muted/30 hover:bg-muted/50 text-foreground placeholder-muted-foreground mb-2 w-full appearance-none rounded-full px-3 py-2 text-sm leading-tight shadow outline-none focus:outline-none"
            id="library-path"
            type="text"
            placeholder="e.g. /storage/Photos"
          />

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

      <button
        hlmBtn
        type="button"
        (click)="addLibraryPaths()"
        class="bg-muted/50 hover:bg-muted/70 text-foreground rounded-full px-3 py-2 text-sm mb-6"
      >
        Add Another Path
      </button>

      <!--auto import checkbox-->
      <div class="flex items-center gap-3 mb-6">
        <hlm-checkbox id="album" [formControl]="albumCheckbox" />
        <label class="text-foreground" hlmLabel for="album">Auto import albums?</label>
      </div>

      <div class="flex justify-end w-full">
        <button
          hlmBtn
          type="button"
          class="bg-muted/50 hover:bg-muted/70 text-foreground rounded-full px-3 py-2 text-sm mb-6"
          (click)="saveLibraryManagementInfo()"
        >
          Save
        </button>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
      padding: 1rem;
      flex: 1;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Setup {
  albumCheckbox = new FormControl<boolean>(false);

  //can have more than 1 library path, to begin with only 1 field will be visible, but can be expanded
  libraryPathsArray = new FormArray([
    new FormControl<string | null>(null, [Validators.required]), // Start with one input
  ]);

  addLibraryPaths(): void {
    this.libraryPathsArray.push(new FormControl<string | null>(null, [Validators.required]));
  }

  removeInput(index: number) {
    if (this.libraryPathsArray.length > 1) {
      this.libraryPathsArray.removeAt(index);
    }
  }

  getAllLibraryPaths() {
    return this.libraryPathsArray.value;
  }

  saveLibraryManagementInfo() {
    console.log("clicked button...");

    const nonBlankPaths = this.getAllLibraryPaths().filter(value => value && value.trim() !== '');

    /*this.libraryPathsArray.valid && */
    if (nonBlankPaths.length > 0) {
      console.log('Saving:', nonBlankPaths);
      console.log('AlbumCheckboxState:', this.albumCheckbox.value);
    } else {
      console.log('Form invalid or no valid entries');
      // Mark all as touched to show validation errors
      this.libraryPathsArray.markAllAsTouched();
    }
  }
}
