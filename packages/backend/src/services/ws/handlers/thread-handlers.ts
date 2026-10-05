// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import crypto from 'crypto';
import type { ClientMessage, ServerMessage, Thread, ThreadSummary } from '@aerie/shared';
import {
  getMessages,
  markMessagesRead,
  createThread,
  getThread,
  messagePreviewText,
} from '../../db.js';
import { assignCompanionToThread } from '../../db/companions.js';
import { registry } from '../connection-registry.js';
import type { ExtendedWebSocket } from '../connection-registry.js';

// --- Shared helpers (also used by ws.ts and other handler modules) ---

export function getLastMessagePreview(threadId: string): string | null {
  const msgs = getMessages({ threadId, limit: 1 });
  if (!msgs.length) return null;
  const last = msgs[msgs.length - 1];
  const spoken = messagePreviewText(last.content, last.metadata);
  if (!spoken) return null;
  return spoken.substring(0, 100).replace(/\n/g, ' ').trim() || null;
}

export function threadsToSummaries(threads: Thread[]): ThreadSummary[] {
  return threads.map(t => ({
    id: t.id,
    name: t.name,
    type: t.type,
    unread_count: t.unread_count,
    last_activity_at: t.last_activity_at,
    last_message_preview: getLastMessagePreview(t.id),
    pinned_at: t.pinned_at ?? null,
  }));
}

// --- Thread handlers ---

export function handleSync(
  msg: Extract<ClientMessage, { type: 'sync' }>,
  ws: ExtendedWebSocket,
): void {
  const messages = getMessages({
    threadId: msg.threadId,
    limit: 200,
  });

  // The phone may have *seen* a live WebSocket reply, advanced its local
  // high-water mark, and then had an older REST snapshot repaint the visible
  // message list. Returning a small overlap lets reconnect sync heal that
  // already-persisted reply instead of trusting a marker that only proves it
  // crossed the socket once. The client deduplicates by message id.
  const recoveryFloor = Math.max(0, msg.lastSeenSequence - 50);
  const missed = messages.filter(m => m.sequence > recoveryFloor);

  const response: ServerMessage = {
    type: 'sync_response',
    messages: missed,
  };
  ws.send(JSON.stringify(response));
}

export function handleRead(
  msg: Extract<ClientMessage, { type: 'read' }>,
): void {
  markMessagesRead(msg.threadId, msg.beforeId, new Date().toISOString());

  registry.broadcast({
    type: 'unread_update',
    threadId: msg.threadId,
    count: 0,
  });
}

export function handleSwitchThread(
  msg: Extract<ClientMessage, { type: 'switch_thread' }>,
  ws: ExtendedWebSocket,
): void {
  const messages = getMessages({ threadId: msg.threadId, limit: 50 });

  const response: ServerMessage = {
    type: 'sync_response',
    messages,
  };
  ws.send(JSON.stringify(response));
}

export function handleCreateThread(
  msg: Extract<ClientMessage, { type: 'create_thread' }>,
): void {
  const thread = createThread({
    id: crypto.randomUUID(),
    name: msg.name,
    type: 'named',
    createdAt: new Date().toISOString(),
    sessionType: 'v2',
  });

  if (msg.companionIds && msg.companionIds.length > 0) {
    for (const companionId of msg.companionIds) {
      try {
        assignCompanionToThread(thread.id, companionId, 'participant', true);
      } catch (err) {
        console.warn(`[WS] Failed to assign companion ${companionId} to thread:`, err);
      }
    }
  }

  registry.broadcast({ type: 'thread_created', thread });
}
