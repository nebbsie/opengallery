import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-logo',
  imports: [],
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 200 200">
      <path
        class="hover:opacity-90"
        d="M 100 100 L 200 100 A 100 100 0 0 1 100 200 Z"
        fill="#4285F4"
      />
      <path
        class="hover:opacity-90"
        d="M 100 100 L 100 200 A 100 100 0 0 1 0 100 Z"
        fill="#EA4335"
      />
      <path class="hover:opacity-90" d="M 100 100 L 0 100 A 100 100 0 0 1 100 0 Z" fill="#FBBC04" />
      <path
        class="hover:opacity-90"
        d="M 100 100 L 100 0 A 100 100 0 0 1 200 100 Z"
        fill="#34A853"
      />
    </svg>
  `,
  styles: `
    :host {
      display: block;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Logo {
  size = input<number>(48);
}
