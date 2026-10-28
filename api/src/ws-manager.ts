import type { WebSocket } from "ws";

type WsEvent = {
  event: string;
  data: unknown;
};

class WsManager {
  private clients = new Map<string, Set<WebSocket>>();

  add(socket: WebSocket, userId: string): void {
    if (!this.clients.has(userId)) {
      this.clients.set(userId, new Set());
    }
    this.clients.get(userId)!.add(socket);

    socket.on("close", () => {
      this.clients.get(userId)?.delete(socket);
      if (this.clients.get(userId)?.size === 0) {
        this.clients.delete(userId);
      }
    });
  }

  // Sends to every connected user, admins and viewers alike. Never put a file
  // id, person id or name in the payload: a viewer must not learn about a
  // file or person hidden from them. Send a bare "something changed" signal.
  broadcast(event: string, data: unknown): void {
    const message = JSON.stringify({ event, data } satisfies WsEvent);
    for (const sockets of this.clients.values()) {
      for (const socket of sockets) {
        if (socket.readyState === socket.OPEN) {
          socket.send(message);
        }
      }
    }
  }
}

export const wsManager = new WsManager();
