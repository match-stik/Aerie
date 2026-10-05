// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Thread operations
// Migrated from ../db.ts

import type { Thread } from '@aerie/shared';
import { getAerieConfig } from '../../config.js';
import { getDb } from './state.js';
import { getConfig, getConfigBool } from './config.js';
import { todayLocal, offsetMinutes as getOffsetMinutes } from '../time.js';

export function createThread(params: {
  id: string;
  name: string;
  type: 'daily' | 'named' | 'treehouse';
  createdAt: string;
  sessionType?: 'v1' | 'v2';
}): Thread {
  const stmt = getDb().prepare(`
    INSERT INTO threads (id, name, type, created_at, session_type, last_activity_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    params.id,
    params.name,
    params.type,
    params.createdAt,
    params.sessionType || 'v2',
    params.createdAt
  );

  return getThread(params.id)!;
}

export function getThread(id: string): Thread | null {
  const stmt = getDb().prepare('SELECT * FROM threads WHERE id = ?');
  const row = stmt.get(id);
  return row ? (row as unknown as Thread) : null;
}

export function getTodayThread(): Thread | null {
  // Compute today's date in configured timezone (via moment-timezone for accurate DST)
  const config = getAerieConfig();
  const timezone = config.identity.timezone;
  const now = new Date();
  const localDate = todayLocal(timezone, now); // YYYY-MM-DD

  // Get UTC offset via moment-timezone (handles DST correctly)
  const offsetMins = getOffsetMinutes(timezone, now);

  // Query with offset applied to created_at so SQLite compares in local time
  const modifier = `${offsetMins >= 0 ? '+' : ''}${offsetMins} minutes`;
  const stmt = getDb().prepare(`
    SELECT * FROM threads
    WHERE type = 'daily'
    AND date(created_at, ?) = ?
    AND archived_at IS NULL
    ORDER BY created_at ASC
    LIMIT 1
  `);
  const row = stmt.get(modifier, localDate);
  return row ? (row as unknown as Thread) : null;
}

/**
 * Where an unaddressed message lands when nothing else named a thread —
 * an impulse with no thread_id, a socket message with no threadId, a wake
 * that found the owner nowhere.
 *
 * Daily threads are on by default, so this behaves exactly as it always has.
 * With `orchestrator.daily_threads` set false the owner has said they never
 * want one: fall back to their home thread instead, and only mint a daily as
 * the last resort when no home thread is configured. Turning them off is
 * per-install, so it takes nothing from anyone who wants theirs.
 */
export function getFallbackThread(): Thread | null {
  if (getConfigBool('orchestrator.daily_threads', true)) return getTodayThread();

  const homeThreadId = getConfig('orchestrator.wake_thread_id');
  const home = homeThreadId ? getThread(homeThreadId) : null;
  if (home && !home.archived_at) return home;

  return getTodayThread();
}

export function dailyThreadsEnabled(): boolean {
  return getConfigBool('orchestrator.daily_threads', true);
}

export function listThreads(params: {
  includeArchived?: boolean;
  limit?: number;
  offset?: number;
}): Thread[] {
  const { includeArchived = false, limit = 50, offset = 0 } = params;

  let sql = 'SELECT * FROM threads';
  if (!includeArchived) {
    sql += ' WHERE archived_at IS NULL';
  }
  sql += ' ORDER BY last_activity_at DESC LIMIT ? OFFSET ?';

  const stmt = getDb().prepare(sql);
  const rows = stmt.all(limit, offset);
  return rows as unknown as Thread[];
}

export function getMostRecentActiveThread(): Thread | null {
  // No session filter: Codex threads are stateless but still valid targets
  const stmt = getDb().prepare(`
    SELECT * FROM threads
    WHERE archived_at IS NULL
    ORDER BY last_activity_at DESC
    LIMIT 1
  `);
  const row = stmt.get();
  return row ? (row as unknown as Thread) : null;
}

export function updateThreadSession(threadId: string, sessionId: string | null): void {
  const stmt = getDb().prepare('UPDATE threads SET current_session_id = ? WHERE id = ?');
  stmt.run(sessionId, threadId);
}

export function clearAllThreadSessions(): void {
  const stmt = getDb().prepare('UPDATE threads SET current_session_id = NULL');
  stmt.run();
}

export function updateThreadActivity(threadId: string, timestamp: string, incrementUnread = false): void {
  let sql = 'UPDATE threads SET last_activity_at = ?';
  if (incrementUnread) {
    sql += ', unread_count = unread_count + 1';
  }
  sql += ' WHERE id = ?';

  const stmt = getDb().prepare(sql);
  stmt.run(timestamp, threadId);
}

export function archiveThread(threadId: string, archivedAt: string): void {
  const stmt = getDb().prepare('UPDATE threads SET archived_at = ? WHERE id = ?');
  stmt.run(archivedAt, threadId);
}

/** Put a thread back in the user's list. The only writer that clears archived_at. */
export function unarchiveThread(threadId: string): void {
  const stmt = getDb().prepare('UPDATE threads SET archived_at = NULL WHERE id = ?');
  stmt.run(threadId);
}

export function deleteThread(threadId: string): string[] {
  const db = getDb();

  // Collect fileIds from message metadata before deleting
  const fileIds: string[] = [];
  const msgs = db.prepare('SELECT metadata FROM messages WHERE thread_id = ? AND metadata IS NOT NULL').all(threadId) as Array<{ metadata: string }>;
  for (const row of msgs) {
    try {
      const meta = JSON.parse(row.metadata);
      if (meta.fileId) fileIds.push(meta.fileId);
    } catch { /* skip unparseable */ }
  }

  // Cascading delete in a transaction
  const deleteAll = db.transaction(() => {
    db.prepare('DELETE FROM triggers WHERE thread_id = ?').run(threadId);
    db.prepare('DELETE FROM timers WHERE thread_id = ?').run(threadId);
    db.prepare('DELETE FROM canvases WHERE thread_id = ?').run(threadId);
    db.prepare('DELETE FROM outbound_queue WHERE thread_id = ?').run(threadId);
    db.prepare('DELETE FROM audit_log WHERE thread_id = ?').run(threadId);
    db.prepare('DELETE FROM session_history WHERE thread_id = ?').run(threadId);
    db.prepare('DELETE FROM message_embeddings WHERE message_id IN (SELECT id FROM messages WHERE thread_id = ?)').run(threadId);
    db.prepare('DELETE FROM messages WHERE thread_id = ?').run(threadId);
    db.prepare('DELETE FROM threads WHERE id = ?').run(threadId);
  });
  deleteAll();

  return fileIds;
}

export function pinThread(threadId: string): void {
  const stmt = getDb().prepare('UPDATE threads SET pinned_at = ? WHERE id = ?');
  stmt.run(new Date().toISOString(), threadId);
}

export function unpinThread(threadId: string): void {
  const stmt = getDb().prepare('UPDATE threads SET pinned_at = NULL WHERE id = ?');
  stmt.run(threadId);
}

export function getThreadWithMostRecentUserMessage(withinMinutes: number = 120): Thread | null {
  const cutoff = new Date(Date.now() - withinMinutes * 60 * 1000).toISOString();
  const stmt = getDb().prepare(`
    SELECT t.* FROM threads t
    WHERE t.archived_at IS NULL
    AND EXISTS (
      SELECT 1 FROM messages m
      WHERE m.thread_id = t.id
      AND m.role = 'user'
      AND m.deleted_at IS NULL
      AND m.created_at > ?
    )
    ORDER BY (
      SELECT MAX(m.created_at) FROM messages m
      WHERE m.thread_id = t.id AND m.role = 'user' AND m.deleted_at IS NULL
    ) DESC
    LIMIT 1
  `);
  const row = stmt.get(cutoff);
  return row ? (row as unknown as Thread) : null;
}

export interface CrossThreadActivity {
  threadId: string;
  threadName: string;
  threadType: string;
  lastActivityAt: string;
  lastUserMessageAt: string | null;
  lastUserMessagePreview: string | null;
  minutesAgo: number;
}

export function getRecentCrossThreadActivity(
  excludeThreadId: string,
  withinMinutes: number = 120
): CrossThreadActivity[] {
  const db = getDb();
  const cutoff = new Date(Date.now() - withinMinutes * 60 * 1000).toISOString();

  const rows = db.prepare(`
    SELECT
      t.id as thread_id,
      t.name as thread_name,
      t.type as thread_type,
      t.last_activity_at,
      (
        SELECT m.created_at
        FROM messages m
        WHERE m.thread_id = t.id AND m.role = 'user' AND m.deleted_at IS NULL
        ORDER BY m.sequence DESC LIMIT 1
      ) as last_user_message_at,
      (
        SELECT m.content
        FROM messages m
        WHERE m.thread_id = t.id AND m.role = 'user' AND m.deleted_at IS NULL
        ORDER BY m.sequence DESC LIMIT 1
      ) as last_user_message_preview
    FROM threads t
    WHERE t.id != ?
      AND t.archived_at IS NULL
      AND t.last_activity_at > ?
    ORDER BY t.last_activity_at DESC
    LIMIT 5
  `).all(excludeThreadId, cutoff) as Array<{
    thread_id: string;
    thread_name: string;
    thread_type: string;
    last_activity_at: string;
    last_user_message_at: string | null;
    last_user_message_preview: string | null;
  }>;

  const now = Date.now();
  return rows
    .filter(r => r.last_user_message_at && new Date(r.last_user_message_at).getTime() > Date.now() - withinMinutes * 60 * 1000)
    .map(r => ({
      threadId: r.thread_id,
      threadName: r.thread_name,
      threadType: r.thread_type,
      lastActivityAt: r.last_activity_at,
      lastUserMessageAt: r.last_user_message_at,
      lastUserMessagePreview: r.last_user_message_preview
        ? r.last_user_message_preview.substring(0, 80) + (r.last_user_message_preview.length > 80 ? '...' : '')
        : null,
      minutesAgo: Math.round((now - new Date(r.last_user_message_at!).getTime()) / 60000),
    }));
}
