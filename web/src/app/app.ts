import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  host: {
    class: 'flex flex-col h-screen',
  },
  template: ` <router-outlet /> `,
  imports: [RouterOutlet],
})
export class App {}
