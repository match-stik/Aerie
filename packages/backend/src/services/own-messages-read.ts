// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// When the owner's own messages get their read checks: a side note should
// read as read once a companion has read it, not the moment it is sent.
//
// An owner's message arrives delivered, one check. It is read, two checks, when
// a companion is actually handed it: the turn that starts on it, the next turn
// that hands over a side note nobody read at the time, or the lane saying it
// read a side note live (io/.side-notes-read). The phone hears it as one
// message_read per thread and ticks those bubbles over.
import { markOwnMessagesRead, ownMessageReadAt } from './db.js';
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

/**
 * Whether one of us already has this message of theirs, so the turn waiting for
 * it in the queue has nothing left to do.
 *
 * A picture of theirs sent while a turn runs waits in the queue (it is never a
 * side note). If another turn starts meanwhile, the missed-net finds it unread,
 * hands it over in that turn's [MISSED] block and stamps it read. The queue
 * then ran it again as a turn of its own, unlabeled, and it was answered twice
 * (the owner's ask, Oct 26 2026). The owner rows are only
 * ever stamped by markOwnMessagesRead, when one of us is handed them, so a
 * stamp already there when its turn comes up means it was handed over. Never
 * zero still holds: a turn that went silent rewinds the net, which hands it
 * over again on the next turn.
 */
export function alreadyHandedOver(id: string | null | undefined): boolean {
  if (typeof id !== 'string' || id.length === 0) return false;
  try {
    return ownMessageReadAt(id) !== null;
  } catch {
    // Unsure means run it: a doubled answer beats a lost one.
    return false;
  }
}
