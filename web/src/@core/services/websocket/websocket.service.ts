import { Injectable, OnDestroy, inject } from '@angular/core';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { environment } from '@env/environment';
import { CacheKey } from '@core/services/cache-key.types';

@Injectable({ providedIn: 'root' })
export class WebSocketService implements OnDestroy {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private queryClient = inject(QueryClient);

  constructor() {
    if (typeof WebSocket !== 'undefined') {
      this.connect();
    }
  }

  private connect(): void {
    try {
      this.ws = new WebSocket(environment.api.wsUrl);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data) as { event: string; data: unknown };
        this.handleEvent(message.event, message.data);
      } catch {
        // ignore malformed messages
      }
    };

    this.ws.onclose = (event: CloseEvent) => {
      if (event.code !== 1000) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private handleEvent(event: string, _data: unknown): void {
    switch (event) {
      case 'file:variant-saved':
        this.queryClient.invalidateQueries({ queryKey: [CacheKey.GalleryPhotos] });
        this.queryClient.invalidateQueries({ queryKey: [CacheKey.GalleryAll] });
        this.queryClient.invalidateQueries({ queryKey: [CacheKey.GalleryVideos] });
        this.queryClient.invalidateQueries({ queryKey: [CacheKey.TimelinePhotos] });
        this.queryClient.invalidateQueries({ queryKey: [CacheKey.TimelineAll] });
        this.queryClient.invalidateQueries({ queryKey: [CacheKey.TimelineVideos] });
        break;
    }
  }

  private scheduleReconnect(): void {
    this.reconnectTimer = setTimeout(() => this.connect(), 5000);
  }

  ngOnDestroy(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.close(1000);
      this.ws = null;
    }
  }
}
