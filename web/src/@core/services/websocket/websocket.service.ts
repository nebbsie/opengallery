import { Injectable, OnDestroy, effect, inject } from '@angular/core';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { environment } from '@env/environment';
import { Auth } from '@core/services/auth/auth';
import { CacheKey } from '@core/services/cache-key.types';

@Injectable({ providedIn: 'root' })
export class WebSocketService implements OnDestroy {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private queryClient = inject(QueryClient);
  private auth = inject(Auth);

  constructor() {
    if (typeof WebSocket !== 'undefined') {
      // The server binds a socket to the session's user (and closes it with
      // 4001 when there is none), so only hold one while signed in and open a
      // fresh one for each sign-in.
      effect(() => {
        if (this.auth.isAuthenticated()) {
          this.connect();
        } else {
          this.disconnect();
        }
      });
    }
  }

  private connect(): void {
    if (this.ws) return;
    this.clearReconnectTimer();

    let ws: WebSocket;
    try {
      ws = new WebSocket(environment.api.wsUrl);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onmessage = (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data) as { event: string; data: unknown };
        this.handleEvent(message.event, message.data);
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = (event: CloseEvent) => {
      // Ignore a socket we already replaced or dropped on sign-out.
      if (this.ws !== ws) return;
      this.ws = null;
      if (event.code !== 1000 && event.code !== 4001) {
        this.scheduleReconnect();
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  private disconnect(): void {
    this.clearReconnectTimer();
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.close(1000);
    }
  }

  private handleEvent(event: string, _data: unknown): void {
    switch (event) {
      // Someone finished an upload: new files and maybe a new album.
      case 'upload:finished':
        this.queryClient.invalidateQueries({ queryKey: [CacheKey.AlbumsAll] });
        this.queryClient.invalidateQueries({ queryKey: [CacheKey.AlbumSingle] });
        this.queryClient.invalidateQueries({ queryKey: [CacheKey.UploadConfig] });
        this.queryClient.invalidateQueries({ queryKey: [CacheKey.GalleryPhotos] });
        this.queryClient.invalidateQueries({ queryKey: [CacheKey.GalleryAll] });
        this.queryClient.invalidateQueries({ queryKey: [CacheKey.GalleryVideos] });
        this.queryClient.invalidateQueries({ queryKey: [CacheKey.TimelinePhotos] });
        this.queryClient.invalidateQueries({ queryKey: [CacheKey.TimelineAll] });
        this.queryClient.invalidateQueries({ queryKey: [CacheKey.TimelineVideos] });
        break;
      case 'file:variant-saved':
        // An album page shows the new thumbnail too (for example after an upload).
        this.queryClient.invalidateQueries({ queryKey: [CacheKey.AlbumSingle] });
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
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.auth.isAuthenticated()) this.connect();
    }, 5000);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  ngOnDestroy(): void {
    this.disconnect();
  }
}
