// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The pattern shelf: toy patterns kept in the house, their person's recorded on the
// Toys page and the companions' written from a lane, each one a set of tracks in the
// same [level, ms] steps a lane already plays.
//
// A pattern's tracks are named by motor ORDER rather than by toy: motor1 is
// each toy's first motor, motor2 its second, and so on (the phone's planner
// reads those names; 'main' and 'all' and a motor's own name work too). So a
// pattern recorded on one toy plays on whichever toy is connected later, and
// a track for a motor a toy does not have is simply not played on it.
//
// `companion` is the companion who made it, or null when their person made it on the
// phone. Nothing here plays anything: the phone plays a pattern itself, and a
// lane plays one through the remote (POST /api/internal/toys with pattern),
// which goes through every check the remote has.

import { randomUUID } from 'node:crypto';
import type { ToyStep } from '@aerie/shared';
import { TOY_PATTERN_MAX_MS } from '@aerie/shared';
import { getDb } from './db/state.js';
import { shapeTracks, toyRemoteMaxMs } from './toy-remote.js';

export interface ToyPattern {
  id: string;
  name: string;
  /** Who made it: a companion slug, or null for one their person made on the phone. */
  companion: string | null;
  tracks: Record<string, ToyStep[]>;
  /** The longest track, start to finish: one time through. */
  lengthMs: number;
  createdAt: string;
}

const NAME_MAX = 60;
/** The most patterns the shelf keeps; a save past it is refused, never a silent drop. */
export const SHELF_MAX = 200;
/** An hour of their hand at a fifth of a second a step, per motor. */
const PATTERN_MAX_STEPS = 18_000;

function ensureTable(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS toy_patterns (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      companion TEXT,
      tracks TEXT NOT NULL,
      length_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
}

interface Row {
  id: string;
  name: string;
  companion: string | null;
  tracks: string;
  length_ms: number;
  created_at: string;
}

function fromRow(row: Row): ToyPattern {
  return {
    id: row.id,
    name: row.name,
    companion: row.companion,
    tracks: JSON.parse(row.tracks) as Record<string, ToyStep[]>,
    lengthMs: row.length_ms,
    createdAt: row.created_at,
  };
}

/** A name, trimmed and checked. */
export function patternName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.replace(/\s+/g, ' ').trim();
  if (!name || name.length > NAME_MAX) return null;
  return name;
}

/** A pattern's name and tracks, checked, before anything is stored. One time
 *  through may not be longer than the remote lets one command run. */
export function shapePattern(body: unknown):
  | { ok: true; name: string; tracks: Record<string, ToyStep[]>; lengthMs: number }
  | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null) return { ok: false, error: 'Send a JSON object with name and tracks.' };
  const record = body as Record<string, unknown>;
  const name = patternName(record.name);
  if (!name) return { ok: false, error: `name is the pattern's name, 1 to ${NAME_MAX} characters.` };
  const shaped = shapeTracks(record.tracks, PATTERN_MAX_STEPS, TOY_PATTERN_MAX_MS);
  if (!shaped.ok) return shaped;
  if (shaped.longest > TOY_PATTERN_MAX_MS) {
    return { ok: false, error: `One time through is ${Math.round(shaped.longest / 60_000)} minutes; a pattern is at most ${TOY_PATTERN_MAX_MS / 60_000}.` };
  }
  return { ok: true, name, tracks: shaped.tracks, lengthMs: shaped.longest };
}

/** The shelf, newest first. */
export function listPatterns(): ToyPattern[] {
  ensureTable();
  const rows = getDb().prepare('SELECT * FROM toy_patterns ORDER BY created_at DESC').all() as Row[];
  return rows.map(fromRow);
}

/** One pattern by its id, or by its name (case aside; the newest of that name). */
export function findPattern(ref: string): ToyPattern | null {
  ensureTable();
  const key = ref.trim();
  if (!key) return null;
  const byId = getDb().prepare('SELECT * FROM toy_patterns WHERE id = ?').get(key) as Row | undefined;
  if (byId) return fromRow(byId);
  const byName = getDb()
    .prepare('SELECT * FROM toy_patterns WHERE lower(name) = lower(?) ORDER BY created_at DESC LIMIT 1')
    .get(key.replace(/\s+/g, ' ')) as Row | undefined;
  return byName ? fromRow(byName) : null;
}

export function savePattern(input: { name: string; companion: string | null; tracks: Record<string, ToyStep[]>; lengthMs: number }): ToyPattern | { error: string } {
  ensureTable();
  const count = (getDb().prepare('SELECT COUNT(*) AS n FROM toy_patterns').get() as { n: number }).n;
  if (count >= SHELF_MAX) return { error: `The shelf holds ${SHELF_MAX} patterns and it is full.` };
  const pattern: ToyPattern = { id: randomUUID(), createdAt: new Date().toISOString(), ...input };
  getDb()
    .prepare('INSERT INTO toy_patterns (id, name, companion, tracks, length_ms, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(pattern.id, pattern.name, pattern.companion, JSON.stringify(pattern.tracks), pattern.lengthMs, pattern.createdAt);
  return pattern;
}

export function renamePattern(id: string, name: string): boolean {
  ensureTable();
  return getDb().prepare('UPDATE toy_patterns SET name = ? WHERE id = ?').run(name, id).changes > 0;
}

export function deletePattern(id: string): boolean {
  ensureTable();
  return getDb().prepare('DELETE FROM toy_patterns WHERE id = ?').run(id).changes > 0;
}

/**
 * A lane's play-a-pattern ask, turned into the tracks ask the remote already
 * knows: { companion, pattern, loops?, toyId? } becomes { companion, tracks,
 * loops, toyId? }. Any other ask comes back as it was.
 */
export function expandPatternAsk(body: unknown): { ok: true; body: unknown } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null || !('pattern' in body)) return { ok: true, body };
  const record = body as Record<string, unknown>;
  if (record.tracks !== undefined || record.level !== undefined || record.preset !== undefined || record.light !== undefined) {
    return { ok: false, error: 'A pattern ask plays the pattern and nothing else: leave out tracks, level, preset and light.' };
  }
  const ref = typeof record.pattern === 'string' ? record.pattern : '';
  const pattern = ref ? findPattern(ref) : null;
  if (!pattern) return { ok: false, error: `No pattern on the shelf is called or numbered "${ref}". GET /api/internal/toys/patterns lists them.` };
  const { pattern: _drop, ...rest } = record;
  return { ok: true, body: { ...rest, tracks: firstStretch(pattern.tracks, toyRemoteMaxMs()) } };
}

/** The opening stretch of a pattern, as long as one command may run: a
 *  pattern on the shelf can be an hour, and a lane's play hears it a
 *  command at a time. */
export function firstStretch(tracks: Record<string, ToyStep[]>, ms: number): Record<string, ToyStep[]> {
  const out: Record<string, ToyStep[]> = {};
  for (const [key, steps] of Object.entries(tracks)) {
    const kept: ToyStep[] = [];
    let used = 0;
    for (const [level, stepMs] of steps) {
      if (used >= ms) break;
      const take = Math.min(stepMs, ms - used);
      kept.push([level, take]);
      used += take;
    }
    out[key] = kept;
  }
  return out;
}

/** The shelf as a lane reads it: no steps, just what each pattern is. */
export function shelfForLane() {
  return {
    patterns: listPatterns().map((p) => ({
      id: p.id,
      name: p.name,
      by: p.companion ?? 'their person',
      seconds: Math.round(p.lengthMs / 100) / 10,
      motors: Object.keys(p.tracks),
      createdAt: p.createdAt,
    })),
    how: `Play one with POST /api/internal/toys { companion, pattern: "<name or id>", loops? } (loops is how many times through, one command runs at most ${Math.round(toyRemoteMaxMs() / 1000)} seconds in this house, and it goes through their person's remote like any play). Put one on the shelf with POST /api/internal/toys/patterns { companion, name, tracks: { motor1: [[level, ms], ...], motor2: [...] } }: motor1 is each toy's first motor, motor2 its second; levels 0-20, steps at least 200 ms, one time through at most an hour, and a lane playing one hears up to that much of it a command.`,
  };
}
