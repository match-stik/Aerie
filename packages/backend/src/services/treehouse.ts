// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// treehouse.ts — Companion-only threads
// A space for companions to talk amongst themselves, process thoughts,
// hold context between sessions. User can read but not post.

import { getDb } from './db.js';
import { createMessage } from './db/messages.js';
import { updateThreadActivity } from './db/threads.js';
import { listCompanions } from './db/companions.js';
import { registry } from './ws/connection-registry.js';
import crypto from 'crypto';

const TREEHOUSE_NAME = 'The Treehouse';

export interface TreehouseMessage {
  id: string;
  // 'user' | 'companion' | 'system'. Without this the client can't tell the owner's
  // messages from room-addressed companion replies — both carry no
  // metadata.companionSlug, so both used to render as an unnamed bubble.
  role: string;
  companion_slug: string;
  content: string;
  created_at: string;
}

// Get or create the treehouse thread
export function getTreehouseThread(): { id: string; name: string } {
  const db = getDb();

  let thread = db.prepare('SELECT id, name FROM threads WHERE type = ?').get('treehouse') as { id: string; name: string } | undefined;

  if (!thread) {
    const id = crypto.randomUUID();
    db.prepare(`INSERT INTO threads (id, name, type, created_at, last_activity_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))`)
      .run(id, TREEHOUSE_NAME, 'treehouse');

    // Add all companions to the treehouse
    const companions = listCompanions();
    for (const c of companions) {
      db.prepare('INSERT OR IGNORE INTO thread_companions (thread_id, companion_id, role, added_at) VALUES (?, ?, ?, ?)')
        .run(id, c.id, 'participant', new Date().toISOString());
    }

    thread = { id, name: TREEHOUSE_NAME };
    console.log(`[Treehouse] Created: ${id}`);
  }

  return thread;
}

// Post a message to the treehouse (companion only)
export function postToTreehouse(companionSlug: string, content: string): TreehouseMessage {
  const thread = getTreehouseThread();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  createMessage({
    id,
    threadId: thread.id,
    role: 'companion',
    content,
    contentType: 'text',
    metadata: { companionSlug },
    createdAt: now,
  });

  updateThreadActivity(thread.id, now);

  // Broadcast to connected clients
  registry.broadcast({
    type: 'message',
    message: {
      id,
      thread_id: thread.id,
      role: 'companion',
      companion_slug: companionSlug,
      content,
      content_type: 'text',
      created_at: now,
    } as any,
  });

  return { id, role: 'companion', companion_slug: companionSlug, content, created_at: now };
}

// Get recent treehouse messages (with optional before cursor for pagination)
/**
 * Reported by Rose and Sol, Sep 17 2026, and they found it the only way anybody
 * could have: by deleting a post and watching their companion read it back.
 * Neither query filtered `deleted_at`, so a soft delete removed a post from the
 * app and left it standing in the room for the people who live there — which is
 * the opposite of what deleting means, and silent from every other angle.
 */
export function getTreehouseMessages(limit: number = 50, beforeId?: string): TreehouseMessage[] {
  const thread = getTreehouseThread();
  const db = getDb();

  let rows: Array<{ id: string; role: string; metadata: string | null; content: string; created_at: string }>;

  if (beforeId) {
    // Get sequence of the cursor message for reliable pagination
    const cursor = db.prepare('SELECT sequence FROM messages WHERE id = ?').get(beforeId) as { sequence: number } | undefined;
    if (!cursor) return [];

    rows = db.prepare(`
      SELECT id, role, metadata, content, created_at
      FROM messages
      WHERE thread_id = ? AND sequence < ? AND deleted_at IS NULL
      ORDER BY sequence DESC
      LIMIT ?
    `).all(thread.id, cursor.sequence, limit) as typeof rows;
  } else {
    rows = db.prepare(`
      SELECT id, role, metadata, content, created_at
      FROM messages
      WHERE thread_id = ? AND deleted_at IS NULL
      ORDER BY sequence DESC
      LIMIT ?
    `).all(thread.id, limit) as typeof rows;
  }

  return rows.map(row => ({
    id: row.id,
    role: row.role,
    companion_slug: row.metadata ? JSON.parse(row.metadata).companionSlug || '' : '',
    content: row.content,
    created_at: row.created_at,
  })).reverse();
}

// Check if a thread is the treehouse
export function isTreehouse(threadId: string): boolean {
  const thread = getTreehouseThread();
  return thread.id === threadId;
}

// Get treehouse info
export function getTreehouseInfo(): { id: string; name: string; messageCount: number } {
  const thread = getTreehouseThread();
  const db = getDb();
  const count = db.prepare('SELECT COUNT(*) as count FROM messages WHERE thread_id = ?').get(thread.id) as { count: number };
  return { id: thread.id, name: thread.name, messageCount: count.count };
}
