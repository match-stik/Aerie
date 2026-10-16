// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// When the owner's own messages get their read checks: a side note should
// read as read once a companion has read it, not the moment it is sent.
//
// An owner's message arrives delivered, one check. It is read, two checks, when
// a companion is actually handed it: the turn that starts on it, the next turn
// that hands over a side note nobody read at the time, or the lane saying it
// read a side note live (io/.side-notes-read). The phone hears it as one
// message_read per thread and ticks those bubbles over.
import { markOwnMessagesRead } from './db.js';
import { registry } from './ws/connection-registry.js';

export function ownMessagesRead(ids: ReadonlyArray<string | null | undefined>): void {
  const real = ids.filter((x): x is string => typeof x === 'string' && x.length > 0);
  if (real.length === 0) return;
  const readAt = new Date().toISOString();
  let changed: Array<{ id: string; thread_id: string }>;
  try {
    changed = markOwnMessagesRead(real, readAt);
  } catch {
    // A read check is a courtesy; it must never take a turn down with it.
    return;
  }
  const byThread = new Map<string, string[]>();
  for (const row of changed) byThread.set(row.thread_id, [...(byThread.get(row.thread_id) ?? []), row.id]);
  for (const [threadId, messageIds] of byThread) {
    registry.broadcast({ type: 'message_read', threadId, messageIds, readAt });
  }
}
