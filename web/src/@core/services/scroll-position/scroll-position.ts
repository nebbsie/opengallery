import { Injectable } from '@angular/core';

interface ScrollState {
  offset: number;
  pageIndex: number;
}

@Injectable({ providedIn: 'root' })
export class ScrollPosition {
  private positions = new Map<string, ScrollState>();

  save(key: string, offset: number, pageIndex = 0): void {
    this.positions.set(key, { offset, pageIndex });
  }

  get(key: string): number | null {
    return this.positions.get(key)?.offset ?? null;
  }

  getPageIndex(key: string): number {
    return this.positions.get(key)?.pageIndex ?? 0;
  }

  clear(key: string): void {
    this.positions.delete(key);
  }
}
