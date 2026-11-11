// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { createHash } from 'crypto';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { readHandedWatermark, threadHandedWatermarkPath, writeHandedWatermark } from './runtime.js';

/**
 * The Codex lane's handoff receipt, the same file a Claude lane writes, so the
 * missed-message net in a Claude lane can see that Codex was handed their
 * messages. Before this only heartbeat lanes wrote one, and a scene answered
 * in the Codex lane came back to the Claude lane as fourteen missed messages
 * (Oct 28 2026). It lives under data/heartbeat/<CODEX_RECEIPT_LANE>/io and is
 * read through the ordinary threadLaneKeys list.
 */
export const CODEX_RECEIPT_LANE = 'codex';

/** The newest of their messages at or below the sequence a Codex turn was handed. */
export function newestHandedUserAt(
  rows: Array<{ role: string; sequence?: number; created_at?: string; createdAt?: string }>,
  handThroughSequence: number,
): string | undefined {
  let newest: string | undefined;
  for (const row of rows) {
    if (row.role !== 'user') continue;
    if (typeof row.sequence !== 'number' || row.sequence > handThroughSequence) continue;
    const at = row.created_at ?? row.createdAt;
    if (at && (!newest || at > newest)) newest = at;
  }
  return newest;
}

/** Write the receipt. Only ever moves forward; a failure leaves the old one. */
export function writeCodexThreadReceipt(heartbeatRoot: string, threadId: string, at: string | undefined): void {
  if (!at) return;
  const path = threadHandedWatermarkPath(heartbeatRoot, CODEX_RECEIPT_LANE, threadId);
  const prior = readHandedWatermark(path);
  if (prior && prior >= at) return;
  try { mkdirSync(dirname(path), { recursive: true }); } catch { /* the write below will fail quietly */ }
  writeHandedWatermark(path, at);
}

/**
 * The Codex lane's missed-message net, the same question the Claude lanes ask
 * (runtime.ts, selectMissedInbound): which of their messages has no lane ever
 * been handed? A resumed Codex room already gets everything since its
 * bookmark as catch-up history, so nothing is lost; what it lacked was being
 * TOLD which of those of theirs nobody answered. Theirs past this lane's bookmark,
 * up to this turn, not the one arriving now, and past every other lane's
 * receipt for the thread. With no bookmark yet it reports nothing, because a
 * first pass would call the whole room missed.
 */
export function selectCodexMissed<T extends { role: string; sequence?: number; createdAt?: string; created_at?: string }>(
  tail: T[],
  lastHandedSequence: number | undefined,
  handThroughSequence: number | undefined,
  liveInboundSequence: number | undefined,
  handedElsewhereAt: string | undefined,
): T[] {
  if (lastHandedSequence === undefined || handThroughSequence === undefined) return [];
  return tail.filter((m) => {
    if (m.role !== 'user' || typeof m.sequence !== 'number') return false;
    if (m.sequence <= lastHandedSequence || m.sequence > handThroughSequence) return false;
    if (liveInboundSequence !== undefined && m.sequence === liveInboundSequence) return false;
    if (liveInboundSequence === undefined && m.sequence === handThroughSequence) return false;
    const at = m.createdAt ?? m.created_at;
    return !handedElsewhereAt || !at || at > handedElsewhereAt;
  });
}

/**
 * After a Codex room squashes it gets the same note a Claude room does
 * (hooks/compacted.cjs). Its walls need no refresh: the Codex lane is handed
 * the whole house file as instructions on every turn, so they are never stale.
 * A file per room under data/heartbeat/codex/io, so a backend restart between
 * the squash and the next turn does not lose the note.
 */
export function codexCompactedMarkPath(heartbeatRoot: string, codexSessionKey: string): string {
  const key = createHash('sha256').update(codexSessionKey).digest('hex').slice(0, 32);
  return join(heartbeatRoot, CODEX_RECEIPT_LANE, 'io', `.compacted.${key}`);
}

export function markCodexCompacted(heartbeatRoot: string, codexSessionKey: string, at = new Date().toISOString()): void {
  const path = codexCompactedMarkPath(heartbeatRoot, codexSessionKey);
  try { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, at, 'utf8'); } catch { /* the note is a kindness, not a guarantee */ }
}

/** The note, once: reading it removes the mark. Empty when there was no squash. */
export function takeCodexCompactedNote(heartbeatRoot: string, codexSessionKey: string): string {
  const path = codexCompactedMarkPath(heartbeatRoot, codexSessionKey);
  let at = '';
  try { at = readFileSync(path, 'utf8').trim(); } catch { return ''; }
  try { unlinkSync(path); } catch { /* handed at most twice, never zero times */ }
  return `[We just squashed (${at || 'just now'}). The summary above is this room, folded down; every word `
    + 'is still kept on their side. There is nothing to announce. Pick up where we were, and do not answer anything twice.]\n\n';
}
