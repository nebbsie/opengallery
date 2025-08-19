import { Injectable, computed, signal, inject } from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';

@Injectable({ providedIn: 'root' })
export class ScreenSize {
  private observer = inject(BreakpointObserver);

  private breakpoints = {
    sm: '(min-width: 640px)',
    md: '(min-width: 768px)',
    lg: '(min-width: 1024px)',
    xl: '(min-width: 1280px)',
    '2xl': '(min-width: 1536px)',
  };

  private currentBp = signal<keyof typeof this.breakpoints | 'base'>('base');

  readonly current = this.currentBp.asReadonly();

  readonly isMobile = computed(() => this.currentBp() === 'base');
  readonly isSmUp = computed(() => this.currentBp() !== 'base');
  readonly isMdUp = computed(() => ['md', 'lg', 'xl', '2xl'].includes(this.currentBp()));
  readonly isLgUp = computed(() => ['lg', 'xl', '2xl'].includes(this.currentBp()));
  readonly isXlUp = computed(() => ['xl', '2xl'].includes(this.currentBp()));
  readonly is2xlUp = computed(() => this.currentBp() === '2xl');

  constructor() {
    this.observer.observe(Object.values(this.breakpoints)).subscribe((state) => {
      let active: keyof typeof this.breakpoints | 'base' = 'base';
      for (const [bp, query] of Object.entries(this.breakpoints)) {
        if (state.breakpoints[query]) active = bp as keyof typeof this.breakpoints;
      }
      this.currentBp.set(active);
    });
  }
}
