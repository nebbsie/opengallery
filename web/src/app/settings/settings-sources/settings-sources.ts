import { ChangeDetectionStrategy, Component } from '@angular/core';
import { injectTrpcClient } from '@core/services/trpc';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideTrash2, lucideCircleHelp } from '@ng-icons/lucide';
import { FormArray, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { BrnTooltipContentTemplate } from '@spartan-ng/brain/tooltip';
import { HlmTooltip, HlmTooltipTrigger } from '@spartan-ng/helm/tooltip';

@Component({
  selector: 'app-settings-sources',
  providers: [provideIcons({ lucideTrash2, lucideCircleHelp })],
  imports: [
    ReactiveFormsModule,
    HlmButton,
    HlmIcon,
    NgIcon,
    HlmTooltipTrigger,
    BrnTooltipContentTemplate,
    HlmTooltip,
  ],
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

      <div class="flex flex-auto flex-col items-start">
        <button
          hlmBtn
          type="button"
          (click)="addLibraryPaths()"
          class="bg-muted/50 hover:bg-muted/70 text-foreground mb-6 rounded-full px-3 py-2 text-sm"
        >
          Add Another Path
        </button>

        <div class="mb-6 flex items-center">
          <button
            hlmBtn
            type="button"
            class="bg-muted/50 hover:bg-muted/70 text-foreground rounded-full px-3 py-2 text-sm"
          >
            Auto Import Albums
          </button>

          <hlm-tooltip>
            <button
              hlmTooltipTrigger
              class="text-foreground ml-1"
              hlmBtn
              variant="ghost"
              size="sm"
            >
              <ng-icon hlm size="sm" name="lucideCircleHelp" />
            </button>
            <span *brnTooltipContent>This job scans your file system structure and creates albums based on your existing folder structure.</span>
          </hlm-tooltip>
        </div>

        <div class="flex w-full justify-end">
          <button
            hlmBtn
            type="button"
            class="bg-muted/50 hover:bg-muted/70 text-foreground mb-6 rounded-full px-3 py-2 text-sm"
            (click)="saveLibraryManagementInfo()"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
      padding: 1rem;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsSources {
  private trpc = injectTrpcClient();

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
    console.log('clicked button...');

    const nonBlankPaths = this.getAllLibraryPaths().filter((value) => value && value.trim() !== '');

    /*this.libraryPathsArray.valid && */
    if (nonBlankPaths.length > 0) {
      console.log('Saving:', nonBlankPaths);
    } else {
      console.log('Form invalid or no valid entries');
      // Mark all as touched to show validation errors
      this.libraryPathsArray.markAllAsTouched();
    }
  }

  test() {
    this.trpc.mediaLocations.create.mutate('aaron');
  }
}
