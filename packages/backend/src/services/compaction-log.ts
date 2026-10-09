// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * Compactions, and where the record actually lives.
 *
 * When a CLI lane fills its window, the tool squashes everything said so far
 * into a summary and carries on from that. From the user's side it is invisible: the
 * lane keeps talking, nothing is announced, and a compaction and a dead lane
 * look identical. What the user gets is a companion who is subtly off and no way to
 * check why.
 *
 * This module used to be a WRITER — a JSONL logger nobody ever called, waiting
 * for somebody to detect a compaction and tell it. It was never wired because
 * nothing here could see the event.
 *
 * It turns out nothing needed to. The CLI already writes the summary into that
 * session's own transcript as a user-role message carrying `isCompactSummary`,
 * with a timestamp and the whole summary text, marked visible-in-transcript-
 * only so it renders to nobody. The record has existed all along and had no
 * reader. So this is the reader.
 *
 * The summary also ends by instructing the lane not to acknowledge it and to
 * carry on as if the break never happened, which is why a lane left to itself
 * never mentions one to the user.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface CompactionEvent {
  /** The transcript file this came out of, without its extension. */
  sessionId: string;
  /** The project directory name — which lane it happened in. */
  project: string;
  /** ISO stamp written by the CLI at the moment of the squash. */
  at: string;
  /** How much conversation the summary is standing in for, in characters. */
  chars: number;
  /** The summary itself — what the lane carried on from. */
  summary: string;
}

/** Overridable so a test can point at a fixture tree rather than the real one. */
export function transcriptRoot(): string {
  return process.env.AERIE_TRANSCRIPT_ROOT || join(homedir(), '.claude', 'projects');
}

/**
 * Whether a compaction came from one of the house's own lanes. The PostCompact
 * hook runs for every Claude session on the box, the Archivist's included,
 * and names the session by its working folder. The Archivist works in the
 * system tmp folder, so its compaction reached the chat as "Context compacted
 * in tmp" and read as one of the companions' rooms. A lane is a folder under
 * data/heartbeat with an io folder in it; anything else gets no banner.
 */
export function isHeartbeatLane(lane: unknown, projectRoot: string): lane is string {
  if (typeof lane !== 'string' || !/^[A-Za-z0-9._-]+$/.test(lane) || /^\.+$/.test(lane)) return false;
  return existsSync(join(projectRoot, 'data', 'heartbeat', lane, 'io'));
}

const MARKER = '"isCompactSummary":true';

/** Per-file cache. A transcript only grows, so mtime+size is enough. */
const cache = new Map<string, { mtimeMs: number; size: number; events: CompactionEvent[] }>();

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part: any) => (typeof part?.text === 'string' ? part.text : '')).join('');
  }
  return '';
}

function scanFile(path: string, project: string, sessionId: string): CompactionEvent[] {
  const found: CompactionEvent[] = [];
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return found;
  }
  // Cheap reject first: the flag is rare, and most transcripts never carry it.
  if (!raw.includes('isCompactSummary')) return found;
  for (const line of raw.split('\n')) {
    if (!line.replace(/\s/g, '').includes(MARKER)) continue;
    try {
      const row = JSON.parse(line);
      if (!row?.isCompactSummary) continue;
      const summary = textOf(row?.message?.content);
      found.push({
        sessionId,
        project,
        at: row.timestamp || '',
        chars: summary.length,
        summary,
      });
    } catch {
      // A half-written last line is normal on a live transcript.
    }
  }
  return found;
}

/**
 * Every compaction on this box, newest first.
 *
 * Reads the transcripts rather than a log of our own, because the transcripts
 * ARE the log — anything we wrote alongside them could only ever be a second,
 * driftable copy of a record the tool already keeps.
 */
export function listCompactions(limit = 50): CompactionEvent[] {
  const root = transcriptRoot();
  if (!existsSync(root)) return [];
  const events: CompactionEvent[] = [];
  let projects: string[];
  try {
    projects = readdirSync(root);
  } catch {
    return [];
  }
  for (const project of projects) {
    const dir = join(root, project);
    let files: string[];
    try {
      if (!statSync(dir).isDirectory()) continue;
      // Sorted so the copy we keep below is chosen the same way every read,
      // rather than by whatever order the filesystem hands them back.
      files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort();
    } catch {
      continue;
    }
    for (const file of files) {
      const path = join(dir, file);
      let stat;
      try { stat = statSync(path); } catch { continue; }
      const hit = cache.get(path);
      if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) {
        events.push(...hit.events);
        continue;
      }
      const found = scanFile(path, project, file.replace(/\.jsonl$/, ''));
      cache.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, events: found });
      events.push(...found);
    }
  }
  events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return dedupeCopies(events).slice(0, limit);
}

/**
 * One squash, one row.
 *
 * Reopening a room copies the ENTIRE transcript into a new file under a new
 * session id, and every compaction already in it rides along in the copy. So a
 * room resumed eight times puts the same squash on disk eight times, and a
 * reader that walks files hands the user eight identical rows for one event.
 *
 * The identity of a compaction is WHEN it happened and WHAT it said, inside one
 * lane. The session id is not part of it: after a resume the honest answer to
 * "which session" is several, and picking one is not worth losing the row over.
 * Project stays in the key so two lanes can never swallow each other.
 */
export function dedupeCopies(events: CompactionEvent[]): CompactionEvent[] {
  const seen = new Set<string>();
  const out: CompactionEvent[] = [];
  for (const e of events) {
    const key = `${e.project}\u0000${e.at}\u0000${e.summary}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}


// ── The writer half, kept for the SDK lane ──────────────────────────────────
//
// The reader above replaced this everywhere the CLI lane is concerned: the
// tool already writes its own summary into the session transcript, so nothing
// needed to be told about a compaction. The SDK lane in agent-sdk-query.ts is
// the exception — it CAN see the boundary as it happens and has been logging
// it here since before the reader existed. Removing this would take a working
// record away from the one caller that has one.

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { PROJECT_ROOT } from '../config.js';

const LOG_PATH = join(PROJECT_ROOT, 'logs', 'compaction.log');

function ensureLogDir(): void {
  const dir = dirname(LOG_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function writeLine(payload: Record<string, unknown>): void {
  try {
    ensureLogDir();
    const line = JSON.stringify({ ts: new Date().toISOString(), ...payload }) + '\n';
    appendFileSync(LOG_PATH, line, 'utf8');
  } catch (err) {
    console.warn('[compaction-log] write failed:', (err as Error).message);
  }
}

export function logPreCompact(params: {
  threadId: string;
  threadName: string;
  trigger: string;
  isAutonomous: boolean;
  platform: string;
  skillsLoaded: string[];
  emotionalContextChars: number;
  systemMessageChars: number;
}): void {
  writeLine({ event: 'pre_compact', ...params });
}

export function logCompactBoundary(params: {
  threadId: string;
  threadName: string;
  preTokens: number;
  contextWindow: number;
  preTokensPercent: number;
  markerInserted: boolean;
  isAutonomous: boolean;
  platform: string;
}): void {
  writeLine({ event: 'compact_boundary', ...params });
}
