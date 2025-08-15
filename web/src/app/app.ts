import { Component, inject } from '@angular/core';
import { Health } from '@core/services/health/health';
import { JsonPipe } from '@angular/common';

@Component({
  selector: 'app-root',
  template: `
    @if (currentHealth.isLoading()) {
      <p>Loading...</p>
    } @else if (currentHealth.isError()) {
      <p>Error: {{ currentHealth.error().message }}</p>
    } @else if (currentHealth.isSuccess()) {
      <span> {{ currentHealth.data() | json }}</span>
    }
  `,
  imports: [JsonPipe],
})
export class App {
  private health = inject(Health);

  currentHealth = this.health.get();
}
