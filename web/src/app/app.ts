import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { environment } from '../environments/environment';

@Component({
  selector: 'app-root',
  template: `<h1 class="text-3xl font-bold underline">{{ environment.environment }}</h1>`,
})
export class App {
  protected readonly title = signal('opengallery');
  protected readonly environment = environment;
}
