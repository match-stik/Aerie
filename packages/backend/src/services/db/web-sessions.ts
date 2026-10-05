// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Web session (auth) operations
// Migrated from ../db.ts

import type { WebSession } from '@aerie/shared';
import { getDb } from './state.js';

export function createWebSession(params: {
  id: string;
  token: string;
  createdAt: string;
  expiresAt: string;
}): WebSession {
  const stmt = getDb().prepare(`
    INSERT INTO web_sessions (id, token, created_at, expires_at)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(params.id, params.token, params.createdAt, params.expiresAt);

  return {
    id: params.id,
    token: params.token,
    created_at: params.createdAt,
    expires_at: params.expiresAt,
  };
}

export function getWebSession(token: string): WebSession | null {
  const stmt = getDb().prepare('SELECT * FROM web_sessions WHERE token = ?');
  const row = stmt.get(token);
  return row ? (row as unknown as WebSession) : null;
}

// Push a live session's expiry further out. Sliding renewal: living in the app
// should never log the owner out, so an active session keeps buying itself more time.
export function touchWebSession(token: string, expiresAt: string): void {
  const stmt = getDb().prepare('UPDATE web_sessions SET expires_at = ? WHERE token = ?');
  stmt.run(expiresAt, token);
}

export function deleteExpiredSessions(): void {
  const stmt = getDb().prepare('DELETE FROM web_sessions WHERE expires_at < ?');
  stmt.run(new Date().toISOString());
}

// A session is the row, not the cookie. Clearing a cookie only makes one device
// forget its token; the row is what makes that token good anywhere it was copied.
export function deleteWebSession(token: string): void {
  getDb().prepare('DELETE FROM web_sessions WHERE token = ?').run(token);
}

// After a password change nobody should still be holding the old way in, except
// the person who just changed it. With no token to keep, every session goes.
export function deleteOtherWebSessions(keepToken: string | undefined): number {
  const result = keepToken
    ? getDb().prepare('DELETE FROM web_sessions WHERE token != ?').run(keepToken)
    : getDb().prepare('DELETE FROM web_sessions').run();
  return result.changes;
}
