// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import type { WebSocket } from 'ws';

export interface ConnectionRegistry {
  add(userId: string, ws: WebSocket): void;
  remove(userId: string, ws: WebSocket): void;
  broadcast(message: unknown): void;
  getCount(): number;
}
