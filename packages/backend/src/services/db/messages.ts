// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Message operations
// Migrated from ../db.ts

import type { Message } from '@aerie/shared';
import { getDb } from './state.js';
import { embed, vectorToBuffer } from '../embeddings.js';
import { saveEmbedding } from './embeddings.js';
import { cacheEmbedding } from '../vector-cache.js';
import { getThread } from './threads.js';

// Async embedding helper — fire-and-forget from createMessage
async function embedMessageAsync(messageId: string, content: string, meta: {
  threadId: string; role: string; createdAt: string;
}): Promise<void> {
  try {
    const vector = await embed(content);
    saveEmbedding(messageId, vectorToBuffer(vector));
    // Also update in-memory cache for fast semantic search
    const thread = getThread(meta.threadId);
    cacheEmbedding(messageId, vector, {
      threadId: meta.threadId,
      threadName: thread?.name || 'Unknown',
      role: meta.role,
      createdAt: meta.createdAt,
    });
  } catch (err) {
    console.error(`[embeddings] Failed to embed message ${messageId}:`, err);
  }
}

export function getNextSequence(threadId: string): number {
  const stmt = getDb().prepare('SELECT MAX(sequence) as max_seq FROM messages WHERE thread_id = ?');
  const row = stmt.get(threadId) as { max_seq: number | null };
  return (row.max_seq || 0) + 1;
}

export function createMessage(params: {
  id: string;
  threadId: string;
  role: 'companion' | 'user' | 'system';
  content: string;
  contentType?: 'text' | 'image' | 'audio' | 'file' | 'sticker';
  platform?: 'web' | 'discord' | 'telegram' | 'api';
  companionId?: string;
  metadata?: Record<string, unknown>;
  replyToId?: string;
  createdAt: string;
}): Message {
  const sequence = getNextSequence(params.threadId);

  const stmt = getDb().prepare(`
    INSERT INTO messages (
      id, thread_id, sequence, role, content, content_type, platform, companion_id, metadata, reply_to_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    params.id,
    params.threadId,
    sequence,
    params.role,
    params.content,
    params.contentType || 'text',
    params.platform || 'web',
    params.companionId || null,
    params.metadata ? JSON.stringify(params.metadata) : null,
    params.replyToId || null,
    params.createdAt
  );

  // Fire-and-forget embedding for text messages (non-system)
  if (params.role !== 'system' && (!params.contentType || params.contentType === 'text') && params.content.length > 10) {
    embedMessageAsync(params.id, params.content, {
      threadId: params.threadId,
      role: params.role,
      createdAt: params.createdAt,
    }).catch(() => {});
  }

  return getMessage(params.id)!;
}

export function getMessage(id: string): Message | null {
  const stmt = getDb().prepare('SELECT * FROM messages WHERE id = ?');
  const row = stmt.get(id);
  if (!row) return null;

  const message = row as unknown as Message;
  if (message.metadata && typeof message.metadata === 'string') {
    message.metadata = JSON.parse(message.metadata);
  }
  return message;
}

// The preview/notification text rule lives in @aerie/shared so the phone
// and the backend answer "what does this message say" identically.
export { messagePreviewText } from '@aerie/shared';

export function getMessages(params: {
  threadId: string;
  before?: string;
  limit?: number;
}): Message[] {
  const { threadId, before, limit = 50 } = params;

  let sql = 'SELECT * FROM messages WHERE thread_id = ? AND deleted_at IS NULL';
  const sqlParams: unknown[] = [threadId];

  if (before) {
    sql += ' AND sequence < (SELECT sequence FROM messages WHERE id = ?)';
    sqlParams.push(before);
  }

  sql += ' ORDER BY sequence DESC LIMIT ?';
  sqlParams.push(limit);

  const stmt = getDb().prepare(sql);
  const rows = stmt.all(...sqlParams);

  const messages = (rows as unknown as Message[]).map(msg => {
    if (msg.metadata && typeof msg.metadata === 'string') {
      msg.metadata = JSON.parse(msg.metadata);
    }
    return msg;
  });

  return messages.reverse(); // Return in chronological order
}

/** Get messages surrounding a specific message (N before + the message + N after). */
export function getMessageContext(messageId: string, windowSize: number = 2): Message[] {
  const target = getDb().prepare('SELECT thread_id, sequence FROM messages WHERE id = ?').get(messageId) as { thread_id: string; sequence: number } | undefined;
  if (!target) return [];

  const rows = getDb().prepare(`
    SELECT * FROM messages
    WHERE thread_id = ? AND deleted_at IS NULL
      AND sequence BETWEEN ? AND ?
    ORDER BY sequence ASC
  `).all(target.thread_id, target.sequence - windowSize, target.sequence + windowSize);

  return (rows as unknown as Message[]).map(msg => {
    if (msg.metadata && typeof msg.metadata === 'string') {
      msg.metadata = JSON.parse(msg.metadata);
    }
    return msg;
  });
}

export function editMessage(id: string, newContent: string, editedAt: string): void {
  const stmt = getDb().prepare(`
    UPDATE messages
    SET content = ?, edited_at = ?, original_content = COALESCE(original_content, content)
    WHERE id = ?
  `);
  stmt.run(newContent, editedAt, id);
}

export function softDeleteMessage(id: string, deletedAt: string): void {
  const stmt = getDb().prepare('UPDATE messages SET deleted_at = ? WHERE id = ?');
  stmt.run(deletedAt, id);
}

/** Soft-delete all messages in a thread with sequence > afterSequence. Returns deleted IDs. */
export function softDeleteAfterSequence(threadId: string, afterSequence: number, deletedAt: string): string[] {
  const rows = getDb().prepare(
    'SELECT id FROM messages WHERE thread_id = ? AND sequence > ? AND deleted_at IS NULL'
  ).all(threadId, afterSequence) as Array<{ id: string }>;

  if (rows.length > 0) {
    getDb().prepare(
      'UPDATE messages SET deleted_at = ? WHERE thread_id = ? AND sequence > ? AND deleted_at IS NULL'
    ).run(deletedAt, threadId, afterSequence);
  }

  return rows.map(r => r.id);
}

export function markMessagesRead(threadId: string, beforeId: string, readAt: string): void {
  const stmt = getDb().prepare(`
    UPDATE messages
    SET read_at = ?
    WHERE thread_id = ?
    AND sequence <= (SELECT sequence FROM messages WHERE id = ?)
    AND read_at IS NULL
  `);
  stmt.run(readAt, threadId, beforeId);

  // Reset unread count
  const resetStmt = getDb().prepare('UPDATE threads SET unread_count = 0 WHERE id = ?');
  resetStmt.run(threadId);
}

export function searchMessages(params: {
  query: string;
  threadId?: string;
  limit?: number;
  offset?: number;
}): { messages: Array<{ id: string; thread_id: string; role: string; content: string; content_type: string; created_at: string; thread_name: string }>; total: number } {
  const { query, threadId, limit = 50, offset = 0 } = params;
  // The LIKE below uses backslash as its escape character, so a backslash in the
  // search has to be escaped too or it swallows the character after it.
  const escapedQuery = query.replace(/[\\%_]/g, '\\$&');
  const searchPattern = `%${escapedQuery}%`;

  let whereClause = "WHERE m.deleted_at IS NULL AND m.content LIKE ? ESCAPE '\\'";
  const countParams: unknown[] = [searchPattern];
  const selectParams: unknown[] = [searchPattern];

  if (threadId) {
    whereClause += ' AND m.thread_id = ?';
    countParams.push(threadId);
    selectParams.push(threadId);
  }

  const countStmt = getDb().prepare(`SELECT COUNT(*) as total FROM messages m ${whereClause}`);
  const { total } = countStmt.get(...countParams) as { total: number };

  const selectStmt = getDb().prepare(`
    SELECT m.id, m.thread_id, m.role, m.content, m.content_type, m.created_at, t.name as thread_name
    FROM messages m
    JOIN threads t ON t.id = m.thread_id
    ${whereClause}
    ORDER BY m.created_at DESC
    LIMIT ? OFFSET ?
  `);
  selectParams.push(limit, offset);

  const rows = selectStmt.all(...selectParams) as Array<{
    id: string; thread_id: string; role: string; content: string;
    content_type: string; created_at: string; thread_name: string;
  }>;

  return { messages: rows, total };
}
