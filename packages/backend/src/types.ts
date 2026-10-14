// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import type { WebSocket } from 'ws';

export interface ConnectionRegistry {
  add(userId: string, ws: WebSocket): void;
  remove(userId: string, ws: WebSocket): void;
  broadcast(message: unknown): void;
  getCount(): number;
}
