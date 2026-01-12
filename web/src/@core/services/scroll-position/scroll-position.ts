import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ScrollPosition {
  private positions = new Map<string, number>();

  save(key: string, position: number): void {
    this.positions.set(key, position);
  }

  get(key: string): number | null {
    return this.positions.get(key) ?? null;
  }

  clear(key: string): void {
    this.positions.delete(key);
  }
}
