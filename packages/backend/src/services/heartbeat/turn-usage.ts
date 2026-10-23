// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
/**
 * What one heartbeat turn actually spent, read from Claude Code's transcript.
 *
 * Two things in that transcript make a running total lie about a turn.
 *
 * One API reply is written as several records, one per content block
 * (thinking, text, each tool call), and every one of them carries the reply's
 * whole usage. Summing records counts a reply two or three times.
 *
 * A resumed room starts a NEW transcript that retypes the whole chain before
 * it, with the same message ids and the same timestamps. The lane used to keep
 * its baseline in memory, so the first turn after every restart had none, and
 * filed the whole room's lifetime as one turn: rows of a billion cache reads
 * apiece, which no single turn can spend.
 *
 * So a turn counts each reply once, by the id its records share, and only the
 * replies newer than the lane's watermark: the timestamp of the newest reply
 * already filed, kept on disk so a restart cannot reset it. With no watermark
 * the floor is the start of the turn, so nothing older can ever be filed now.
 */
import { readFileSync, renameSync, writeFileSync } from 'fs';
import { replyKey } from '../agent/session-list.js';
import { forEachLine } from '../transcript-lines.js';

export const USAGE_WATERMARK_FILE = '.usage-watermark';

export interface TurnUsage {
  /** Replies counted, each once. */
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** When the newest counted reply started (ms), or undefined when none was new. */
  newest?: number;
  /** The newest counted reply's model. */
  model?: string;
}

// Same marker session-list skips: the entry Claude Code appends when a session
// dies on an error. It carries an all-zero usage block and is never a reply.
const SYNTHETIC_MODEL = '<synthetic>';

/** Counts one transcript line at a time: every reply that started after
 *  sinceMs, each counted once. */
function usageCounter(sinceMs: number): { take: (line: string) => void; turn: TurnUsage } {
  const turn: TurnUsage = { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  const seen = new Set<string>();
  const take = (line: string): void => {
    if (!line.includes('"usage"')) return;
    let entry: any;
    try { entry = JSON.parse(line); } catch { return; }
    if (entry?.type !== 'assistant') return;
    const u = entry.message?.usage;
    if (!u || entry.message?.model === SYNTHETIC_MODEL) return;
    // A reply is dated by its FIRST record, so it is marked seen before the
    // date is checked: a later record of a reply filed last turn can land
    // after the watermark and must not bring the reply back.
    const key = replyKey(entry);
    if (key) {
      if (seen.has(key)) return;
      seen.add(key);
    }
    const at = Date.parse(entry.timestamp);
    if (!Number.isFinite(at) || at <= sinceMs) return;
    turn.requests += 1;
    turn.inputTokens += u.input_tokens || 0;
    turn.outputTokens += u.output_tokens || 0;
    turn.cacheReadTokens += u.cache_read_input_tokens || 0;
    turn.cacheWriteTokens += u.cache_creation_input_tokens || 0;
    if (turn.newest === undefined || at > turn.newest) {
      turn.newest = at;
      if (typeof entry.message?.model === 'string') turn.model = entry.message.model;
    }
  };
  return { take, turn };
}

/** Every reply in the transcript that started after sinceMs, each counted once. */
export function usageSince(raw: string, sinceMs: number): TurnUsage {
  const counter = usageCounter(sinceMs);
  for (const line of raw.split('\n')) counter.take(line);
  return counter.turn;
}

/** The same count straight off the file, a line at a time and never the whole
 *  file at once: this runs after every turn on the live room's transcript,
 *  which at 159 MB, read whole, filled the backend's heap (Oct 21 2026). */
export async function usageSinceFile(path: string, sinceMs: number): Promise<TurnUsage | undefined> {
  try {
    const counter = usageCounter(sinceMs);
    await forEachLine(path, counter.take);
    return counter.turn;
  } catch {
    return undefined;
  }
}

/** The lane's watermark. Missing or unreadable is undefined, never zero: a zero
 *  floor would file the whole transcript, which is the fault this exists for. */
export function readUsageWatermark(path: string): number | undefined {
  try {
    const value = Number(readFileSync(path, 'utf8').trim());
    return Number.isFinite(value) && value > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

export function writeUsageWatermark(path: string, ms: number): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, String(ms));
  renameSync(tmp, path);
}
