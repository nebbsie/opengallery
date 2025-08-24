import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  OnDestroy,
  OnInit, signal,
  ViewChild
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { lucideCirclePause, lucideCirclePlay, lucideVolume1, lucideVolume2, lucideVolumeX, lucideFullscreen, lucideMinimize, lucideMaximize } from '@ng-icons/lucide';

@Component({
  selector: 'app-video-player',
  providers: [
    provideIcons({
      lucideCirclePlay,
      lucideCirclePause,
      lucideVolumeX,
      lucideVolume1,
      lucideVolume2,
      lucideFullscreen,
      lucideMinimize,
      lucideMaximize
    }),
  ],
  imports: [NgIcon, HlmIcon],
  template: `
    <div #wrapper
         class="relative w-full max-w-2xl overflow-hidden rounded-lg bg-black"
         (mouseenter)="showControls()"
         (mouseleave)="startAutoHide()"
         (mousemove)="resetIdleTimer()">

      <!-- Video -->
      <video
        #video
        [src]="source()"
        muted
        playsInline
        class="w-full"
        (timeupdate)="onTimeUpdate(video)"
        (loadedmetadata)="onLoadedMetadata(video)"
        (ended)="onVideoEnded(video)"
      ></video>

      <!-- Custom Controls Overlay -->
      <div class="absolute right-0 bottom-0 left-0 flex-col items-center gap-4 bg-gradient-to-t from-black/80 to-black/0 p-4 transition-opacity duration-300"
           [class.opacity-0]="!controlsVisible()"
           [class.opacity-100]="controlsVisible()">

        <!-- Time Display -->
        <div class="flex justify-between items-center">
          <div class="text-center text-sm font-thin text-white/80">
            {{ formatTime(currentTime) }}
          </div>

          <div class="text-center text-sm font-thin text-white/80">
            {{ formatTime(duration) }}
          </div>
        </div>

        <!-- Progress Bar -->
        <input
          type="range"
          min="0"
          [max]="duration"
          [value]="currentTime"
          step="0.1"
          (input)="onSeek($event, video)"
          [style]="getProgressStyle()"
          class="flex-1 mb-6 rounded-full w-full cursor-pointer accent-white focus:outline-none custom-video-player-slider hover:shadow-[0_0_6px_rgba(255,255,255,0.2)]"
        />

        <div class="grid grid-cols-3 items-center w-full px-2">
          <!-- Volume Control Wrapper -->
          <div class="justify-self-start">
            <div class="relative z-10 flex items-center">
              <!-- Volume Button -->
              <button
                class="flex items-center text-white/80 hover:text-white transition"
                (click)="toggleMute(video)"
                (mouseenter)="volumeHover = true"
                (mouseleave)="volumeHover = false"
              >
                @if (video.muted || video.volume === 0) {
                  <ng-icon hlm name="lucideVolumeX" class="h-8 w-8"></ng-icon>
                }
                @if (!video.muted && video.volume > 0.5) {
                  <ng-icon hlm name="lucideVolume2" class="h-8 w-8"></ng-icon>
                }
                @if (!video.muted && video.volume <= 0.5) {
                  <ng-icon hlm name="lucideVolume1" class="h-8 w-8"></ng-icon>
                }
              </button>

              <!-- Volume Slider Popout -->
              <div
                class="flex w-22 items-center justify-center rounded-md transition-opacity duration-200"
                (mouseenter)="volumeHover = true"
                (mouseleave)="volumeHover = false"
              >
                <input
                  #volumeSlider
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  [value]="volume"
                  (input)="onVolumeChange($event, video, volumeSlider)"
                  class="h-1 w-20 cursor-pointer custom-video-player-slider custom-video-player-slider-volume"
                />
              </div>
            </div>
          </div>

          <!-- Play / Pause Button -->
          <div class="justify-self-center">
            <button
              (click)="togglePlay(video)"
              class="z-10 flex items-center text-white/80 hover:text-white transition"
            >
              @if (video.paused) {
                <ng-icon hlm name="lucideCirclePlay" class="h-8 w-8"></ng-icon>
              }
              @if (!video.paused) {
                <ng-icon hlm name="lucideCirclePause" class="h-8 w-8"></ng-icon>
              }
            </button>
          </div>

          <!-- Full screen button -->
          <div class="justify-self-end">
            <button
              class="flex items-center text-white/80 hover:text-white transition z-10"
              (click)="toggleFullscreen(wrapper)"
            >
              @if(!isFullscreen()) {
                <ng-icon hlm name="lucideMaximize" class="w-8 h-8"></ng-icon>
              }
              @if(isFullscreen()) {
                <ng-icon hlm name="lucideMinimize" class="w-8 h-8"></ng-icon>
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VideoPlayer implements AfterViewInit, OnInit, OnDestroy {
  source = input.required<string>();

  // Set initial gradient after view init
  @ViewChild('volumeSlider') volumeSlider!: ElementRef<HTMLInputElement>;

  currentTime = 0;
  duration = 0;
  volume = 1;
  volumeHover = false;
  isFullscreen = signal(false); // reactive fullscreen state
  controlsVisible = signal(true);
  private hideTimeout: any;

  ngAfterViewInit() {
    this.updateVolumeSliderGradient(this.volumeSlider.nativeElement);
  }

  private fullscreenChangeHandler = () => {
    const doc: any = document;
    this.isFullscreen.set(!!(doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement));
  };

  ngOnInit() {
    document.addEventListener('fullscreenchange', this.fullscreenChangeHandler);
    document.addEventListener('webkitfullscreenchange', this.fullscreenChangeHandler);
    document.addEventListener('mozfullscreenchange', this.fullscreenChangeHandler);
    document.addEventListener('MSFullscreenChange', this.fullscreenChangeHandler);

    // initialize state
    this.fullscreenChangeHandler();
  }

  ngOnDestroy() {
    document.removeEventListener('fullscreenchange', this.fullscreenChangeHandler);
    document.removeEventListener('webkitfullscreenchange', this.fullscreenChangeHandler);
    document.removeEventListener('mozfullscreenchange', this.fullscreenChangeHandler);
    document.removeEventListener('MSFullscreenChange', this.fullscreenChangeHandler);
  }

  updateVolumeSliderGradient(slider: HTMLInputElement) {
    const percent = this.volume * 100;
    slider.style.background = `linear-gradient(to right, white ${percent}%, rgba(255,255,255,0.2) ${percent}% 100%)`;
  }

  onLoadedMetadata(video: HTMLVideoElement) {
    this.duration = video.duration;
    this.volume = video.volume;
  }

  onTimeUpdate(video: HTMLVideoElement) {
    this.currentTime = Math.min(video.currentTime, this.duration);
  }

  onSeek(event: Event, video: HTMLVideoElement) {
    const input = event.target as HTMLInputElement;
    video.currentTime = parseFloat(input.value);
  }

  onVideoEnded(video: HTMLVideoElement) {
    // Ensure the UI shows full duration when video ends
    this.currentTime = this.duration;
  }

  formatTime(seconds: number): string {
    if (!seconds) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  togglePlay(video: HTMLVideoElement) {
    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
  }

  toggleMute(video: HTMLVideoElement) {
    //when toggling to unmuted do this check
    if(video.muted && this.volume === 0) {
      this.volume = 1;
      video.volume = this.volume;
    }

    video.muted = !video.muted;
    this.updateVolumeSliderGradient(this.volumeSlider.nativeElement);
  }

  onVolumeChange(event: Event, video: HTMLVideoElement, slider: HTMLInputElement) {
    const input = event.target as HTMLInputElement;
    this.volume = parseFloat(input.value);
    video.volume = this.volume;
    video.muted = this.volume === 0;

    this.updateVolumeSliderGradient(slider);
  }

  toggleFullscreen(container: HTMLElement) {
    const doc: any = document;
    const isCurrentlyFullscreen =
      !!(doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement);

    if (!isCurrentlyFullscreen) {
      if (container.requestFullscreen) container.requestFullscreen();
      else if ((container as any).webkitRequestFullscreen) (container as any).webkitRequestFullscreen();
      else if ((container as any).msRequestFullscreen) (container as any).msRequestFullscreen();
    } else {
      if (doc.exitFullscreen) doc.exitFullscreen();
      else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
      else if (doc.msExitFullscreen) doc.msExitFullscreen();
    }
  }

  showControls() {
    this.controlsVisible.set(true);
    this.resetIdleTimer();
  }

  startAutoHide() {
    clearTimeout(this.hideTimeout);
    this.hideTimeout = setTimeout(() => {
      this.controlsVisible.set(false);
    }, 3000);
  }

  resetIdleTimer() {
    this.controlsVisible.set(true); // make sure visible
    clearTimeout(this.hideTimeout);
    this.hideTimeout = setTimeout(() => {
      this.controlsVisible.set(false);
    }, 3000);
  }

  getProgressStyle() {
    const percent = (this.currentTime / this.duration) * 100;
    return `background: linear-gradient(to right, white ${percent}%, rgba(255,255,255,0.2) ${percent}% 100%)`;
  }
}
