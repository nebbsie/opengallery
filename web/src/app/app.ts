import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  template: `{{ title }}`,
})
export class App {
  protected readonly title = signal('opengallery');
}
