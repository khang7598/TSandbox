/**
 * WebSocket broadcast hub.
 *
 * Used by:
 *  - Hot reload pipeline to notify clients of route changes / compile errors
 *  - Request proxy to stream runtime logs to the UI
 *  - (Phase 2) Yjs collaborative editing
 */

import type { WebSocket } from 'ws'

// Registry of connected clients, keyed by their WebSocket instance
const clients = new Set<WebSocket>()

export function addClient(ws: WebSocket): void {
  clients.add(ws)
  ws.on('close', () => clients.delete(ws))
  ws.on('error', () => clients.delete(ws))
}

export function removeClient(ws: WebSocket): void {
  clients.delete(ws)
}

export function broadcast(payload: Record<string, unknown>): void {
  const msg = JSON.stringify(payload)
  for (const ws of clients) {
    if (ws.readyState === 1 /* OPEN */) {
      ws.send(msg)
    }
  }
}

export function broadcastToRoom(sandboxId: string, payload: Record<string, unknown>): void {
  // For Phase 2 room-based broadcasting; currently broadcasts to all
  broadcast({ ...payload, sandboxId })
}

export function clientCount(): number {
  return clients.size
}
