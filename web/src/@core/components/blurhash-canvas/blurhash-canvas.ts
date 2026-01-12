import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnChanges,
  ViewChild,
  input,
} from '@angular/core';
import { decode } from 'blurhash';

@Component({
  selector: 'app-blurhash-canvas',
  standalone: true,
  template: `<canvas #canvas class="h-full w-full object-cover"></canvas>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BlurhashCanvas implements AfterViewInit, OnChanges {
  @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  blurhash = input.required<string>();
  width = input(32);
  height = input(32);

  ngAfterViewInit(): void {
    this.render();
  }

  ngOnChanges(): void {
    if (this.canvasRef) {
      this.render();
    }
  }

  private render(): void {
    const hash = this.blurhash();
    const w = this.width();
    const h = this.height();

    if (!hash || !this.canvasRef?.nativeElement) return;

    try {
      const pixels = decode(hash, w, h);
      const canvas = this.canvasRef.nativeElement;
      canvas.width = w;
      canvas.height = h;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const imageData = ctx.createImageData(w, h);
      imageData.data.set(pixels);
      ctx.putImageData(imageData, 0, 0);
    } catch (e) {
      console.warn('Failed to decode blurhash:', e);
    }
  }
}
