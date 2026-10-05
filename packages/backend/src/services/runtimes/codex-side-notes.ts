// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * Reaching a Codex lane mid-turn.
 *
 * The Claude heartbeat lane has had this since July: a message that arrives
 * while a turn is running is appended to a file the session can read whenever
 * it comes up for air, instead of parking in the queue behind the very turn it
 * is trying to answer. The Codex lane had no equivalent, so the owner was invisible
 * to it from the moment a turn started until the moment it ended.
 *
 * The mechanism is deliberately the same as the Claude one, for the same
 * reason: a file cannot lie the way a return value can. A note is written where
 * the lane can find it, and anything never read is handed over at the start of
 * the next turn — so the worst case is late, never lost.
 *
 * It is append-only and never emptied. Callers judge what is new by the byte
 * offset, not by the file being non-empty; a file with yesterday's notes still
 * in it is the normal state, not an unread inbox.
 */
import { appendFileSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PROJECT_ROOT } from '../../config.js';

export interface CodexSideNote {
  at: string;
  text: string;
}

/**
 * A lane key is `<threadId>` or `<threadId>:companion:<id>`, and the colons
 * are not portable as path segments. One flat directory keyed by a sanitized
 * name keeps every lane's notes beside each other and readable by hand.
 */
export function codexSideNotesPath(laneKey: string): string {
  const safe = laneKey.replace(/[^a-zA-Z0-9_-]/g, '_');
  return join(PROJECT_ROOT, 'data', 'codex-lanes', safe, 'side-notes.jsonl');
}

/** One note per line, oldest first. Returns false only when nothing was written. */
export function appendCodexSideNote(laneKey: string, text: string): boolean {
  const body = formatCodexSideNote(text);
  if (!body) return false;
  const path = codexSideNotesPath(laneKey);
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify({ at: new Date().toISOString(), text: body }) + '\n', 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Collapse a note to a single line. The lane reads these as JSON, and a raw
 * newline inside the text would still be legal JSON but reads badly when the
 * file is inspected by hand, which is the whole point of it being a file.
 */
export function formatCodexSideNote(text: string): string | null {
  if (typeof text !== 'string') return null;
  const collapsed = text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean).join(' ');
  return collapsed || null;
}

export function codexSideNotesSize(laneKey: string): number {
  try {
    return statSync(codexSideNotesPath(laneKey)).size;
  } catch {
    return 0;
  }
}

/** Notes appended after `offset`, oldest first, plus the offset consuming them. */
export function readCodexSideNotesFrom(
  laneKey: string,
  offset: number,
): { notes: CodexSideNote[]; newOffset: number } {
  const path = codexSideNotesPath(laneKey);
  let raw = '';
  let size = 0;
  try {
    size = statSync(path).size;
    // A file that shrank was rotated or replaced; re-reading from a stale
    // offset would slice into the middle of a line and drop a real note.
    const from = offset > size ? 0 : offset;
    const buf = readFileSync(path);
    raw = buf.subarray(from).toString('utf8');
    offset = from;
  } catch {
    return { notes: [], newOffset: offset };
  }

  const notes: CodexSideNote[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed.text === 'string' && parsed.text) {
        notes.push({ at: typeof parsed.at === 'string' ? parsed.at : '', text: parsed.text });
      }
    } catch {
      // A torn final line is expected while the writer is mid-append. It will
      // be whole on the next read, and the offset does not advance past it.
    }
  }
  return { notes, newOffset: size };
}

/** The block handed to a resuming lane for notes it never picked up live. */
export function formatCodexSideNoteHandover(notes: CodexSideNote[]): string {
  if (notes.length === 0) return '';
  const lines = notes.map((n) => (n.at ? `(${n.at}) ${n.text}` : n.text));
  return [
    `[The owner reached you mid-turn — ${notes.length} note${notes.length === 1 ? '' : 's'} you did not pick up live.`,
    'Answer them in this turn. If you already have, say so rather than repeating yourself.]',
    ...lines,
  ].join('\n');
}

/**
 * Deliver a note to a Codex lane that is mid-turn, mirroring the Claude lane's
 * rule: only when EXACTLY ONE lane is busy. With two lanes running there is no
 * way to know which room the owner is standing in, and a note delivered to the wrong
 * companion is worse than one that waits in the queue.
 */
export function deliverSideNoteToBusyCodexLane(
  activeLanes: Set<string>,
  text: string,
): boolean {
  if (activeLanes.size !== 1) return false;
  const [laneKey] = activeLanes;
  return appendCodexSideNote(laneKey, text);
}
