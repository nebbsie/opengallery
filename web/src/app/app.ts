import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  template: `<h1 class="text-3xl font-bold underline">{{ title() }}</h1>`,
})
export class App {
  protected readonly title = signal('opengallery');
}
