// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Reaction operations
// Migrated from ../db.ts
// Note: These depend on getMessage from messages.ts - circular dependency handled via late import

import { getDb } from './state.js';

export function addReaction(messageId: string, emoji: string, user: 'companion' | 'user'): void {
  // Get message directly to avoid circular import
  const msgStmt = getDb().prepare('SELECT * FROM messages WHERE id = ?');
  const row = msgStmt.get(messageId);
  if (!row) return;

  const msg = row as { metadata: string | null };
  let metadata: Record<string, unknown> = {};
  if (msg.metadata) {
    try {
      metadata = JSON.parse(msg.metadata);
    } catch {
      metadata = {};
    }
  }

  const reactions: Array<{ emoji: string; user: string; created_at: string }> =
    Array.isArray(metadata.reactions) ? [...metadata.reactions] : [];

  // Deduplicate: same user + same emoji = no-op
  if (reactions.some(r => r.emoji === emoji && r.user === user)) return;

  reactions.push({ emoji, user, created_at: new Date().toISOString() });
  metadata.reactions = reactions;

  const stmt = getDb().prepare('UPDATE messages SET metadata = ? WHERE id = ?');
  stmt.run(JSON.stringify(metadata), messageId);
}

export function removeReaction(messageId: string, emoji: string, user: 'companion' | 'user'): void {
  // Get message directly to avoid circular import
  const msgStmt = getDb().prepare('SELECT * FROM messages WHERE id = ?');
  const row = msgStmt.get(messageId);
  if (!row) return;

  const msg = row as { metadata: string | null };
  let metadata: Record<string, unknown> = {};
  if (msg.metadata) {
    try {
      metadata = JSON.parse(msg.metadata);
    } catch {
      metadata = {};
    }
  }

  const reactions: Array<{ emoji: string; user: string; created_at: string }> =
    Array.isArray(metadata.reactions) ? [...metadata.reactions] : [];

  const filtered = reactions.filter(r => !(r.emoji === emoji && r.user === user));
  if (filtered.length === reactions.length) return; // Nothing to remove

  metadata.reactions = filtered;

  const stmt = getDb().prepare('UPDATE messages SET metadata = ? WHERE id = ?');
  stmt.run(JSON.stringify(metadata), messageId);
}
