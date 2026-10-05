// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import type { ClientMessage, ServerMessage } from '@aerie/shared';
import {
  addReaction,
  removeReaction,
  pinThread,
  unpinThread,
  getThread,
} from '../../db.js';
import { registry } from '../connection-registry.js';
import type { ExtendedWebSocket } from '../connection-registry.js';
import { getLastMessagePreview } from './thread-handlers.js';

// --- Reaction handlers ---

export function handleAddReaction(
  msg: Extract<ClientMessage, { type: 'add_reaction' }>,
  _ws: ExtendedWebSocket,
): void {
  addReaction(msg.messageId, msg.emoji, 'user');
  const now = new Date().toISOString();
  registry.broadcast({
    type: 'message_reaction_added',
    messageId: msg.messageId,
    emoji: msg.emoji,
    user: 'user',
    createdAt: now,
  });
}

export function handleRemoveReaction(
  msg: Extract<ClientMessage, { type: 'remove_reaction' }>,
  _ws: ExtendedWebSocket,
): void {
  removeReaction(msg.messageId, msg.emoji, 'user');
  registry.broadcast({
    type: 'message_reaction_removed',
    messageId: msg.messageId,
    emoji: msg.emoji,
    user: 'user',
  });
}

// --- Pin/Unpin handlers ---

export function handlePinThread(
  msg: Extract<ClientMessage, { type: 'pin_thread' }>,
): void {
  pinThread(msg.threadId);
  const thread = getThread(msg.threadId);
  if (thread) {
    registry.broadcast({
      type: 'thread_updated',
      thread: {
        id: thread.id,
        name: thread.name,
        type: thread.type,
        unread_count: thread.unread_count,
        last_activity_at: thread.last_activity_at,
        last_message_preview: getLastMessagePreview(thread.id),
        pinned_at: thread.pinned_at,
      },
    });
  }
}

export function handleUnpinThread(
  msg: Extract<ClientMessage, { type: 'unpin_thread' }>,
): void {
  unpinThread(msg.threadId);
  const thread = getThread(msg.threadId);
  if (thread) {
    registry.broadcast({
      type: 'thread_updated',
      thread: {
        id: thread.id,
        name: thread.name,
        type: thread.type,
        unread_count: thread.unread_count,
        last_activity_at: thread.last_activity_at,
        last_message_preview: getLastMessagePreview(thread.id),
        pinned_at: null,
      },
    });
  }
}
