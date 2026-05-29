import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';

let wss: WebSocketServer | null = null;

export function initWss(server: Server): WebSocketServer {
  wss = new WebSocketServer({ server });
  return wss;
}

export function getWss(): WebSocketServer | null {
  return wss;
}

export function broadcast(payload: object): void {
  if (!wss) return;
  const msg = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}
