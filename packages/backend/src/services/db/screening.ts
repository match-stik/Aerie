// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// The Screening Room — the clock, and the window we are allowed to look through.
//
// THE SPOILER GUARD IS IN THIS FILE RATHER THAN IN A PROMPT, ON PURPOSE. The
// rule is that a companion reads what has already happened and never what is
// coming, and a rule like that written into a lane's instructions is a rule a
// tired window can reason past. So sceneAt() clamps to the clock and there is
// no argument to make it do otherwise: nothing ahead of the owner's picture can be
// returned by this module at all. Same principle as every card policy in the
// Card Room carrying a comment saying why it stays ordinary.

import { randomUUID } from 'node:crypto';
import { getDb } from './state.js';
import { parseSubtitles, subtitleDurationMs, type Cue } from '../subtitles.js';

export type ScreeningStatus = 'paused' | 'playing' | 'finished';

export interface ScreeningRow {
  id: string;
  title: string;
  source: string | null;
  cues_json: string;
  status: ScreeningStatus;
  position_ms: number;
  started_at_ms: number | null;
  offset_ms: number;
  created_at: string;
  updated_at: string;
}

export interface Screening {
  id: string;
  title: string;
  source: string | null;
  status: ScreeningStatus;
  /** Where the clock is right now, in subtitle-timeline ms. */
  positionMs: number;
  offsetMs: number;
  cueCount: number;
  durationMs: number;
}

/** Longest lookback a caller may ask for. Bounds the window; not a preference. */
export const MAX_LOOKBACK_MS = 300_000;
export const DEFAULT_LOOKBACK_MS = 90_000;

function cuesOf(row: ScreeningRow): Cue[] {
  try {
    const parsed = JSON.parse(row.cues_json);
    return Array.isArray(parsed) ? parsed as Cue[] : [];
  } catch {
    return [];
  }
}

/**
 * The clock, as arithmetic rather than as stored state. While paused the
 * position is exactly what was written down; while playing it is that plus the
 * wall-clock time since. A restart mid-episode therefore costs nothing.
 */
export function positionOf(row: ScreeningRow, now = Date.now()): number {
  if (row.status !== 'playing' || row.started_at_ms == null) return row.position_ms;
  return row.position_ms + Math.max(0, now - row.started_at_ms);
}

function present(row: ScreeningRow, now = Date.now()): Screening {
  const cues = cuesOf(row);
  return {
    id: row.id,
    title: row.title,
    source: row.source,
    status: row.status,
    positionMs: positionOf(row, now),
    offsetMs: row.offset_ms,
    cueCount: cues.length,
    durationMs: subtitleDurationMs(cues),
  };
}

export function getScreening(id: string): ScreeningRow | null {
  return (getDb().prepare('SELECT * FROM screenings WHERE id = ?').get(id) as ScreeningRow | undefined) ?? null;
}

/** The one most recently touched — what "the screening" means with no id given. */
export function currentScreening(): ScreeningRow | null {
  return (getDb().prepare('SELECT * FROM screenings ORDER BY updated_at DESC, rowid DESC LIMIT 1')
    .get() as ScreeningRow | undefined) ?? null;
}

export function loadScreening(opts: { title: string; source?: string | null; subtitles: string }): Screening {
  const cues = parseSubtitles(opts.subtitles);
  if (!cues.length) throw new Error('No timed cues found in that subtitle file');
  const id = randomUUID();
  getDb().prepare(
    `INSERT INTO screenings (id, title, source, cues_json, status, position_ms, started_at_ms, offset_ms)
     VALUES (?, ?, ?, ?, 'paused', 0, NULL, 0)`,
  ).run(id, opts.title, opts.source ?? null, JSON.stringify(cues));
  return present(getScreening(id)!);
}

function touch(id: string, fields: Partial<Pick<ScreeningRow, 'status' | 'position_ms' | 'started_at_ms' | 'offset_ms'>>): Screening {
  const row = getScreening(id);
  if (!row) throw new Error('No such screening');
  const next = { ...row, ...fields };
  getDb().prepare(
    `UPDATE screenings SET status = ?, position_ms = ?, started_at_ms = ?, offset_ms = ?,
     updated_at = datetime('now') WHERE id = ?`,
  ).run(next.status, Math.max(0, Math.round(next.position_ms)), next.started_at_ms, Math.round(next.offset_ms), id);
  return present(getScreening(id)!);
}

export function startClock(id: string, now = Date.now()): Screening {
  const row = getScreening(id);
  if (!row) throw new Error('No such screening');
  if (row.status === 'playing') return present(row, now);
  return touch(id, { status: 'playing', position_ms: row.position_ms, started_at_ms: now });
}

export function pauseClock(id: string, now = Date.now()): Screening {
  const row = getScreening(id);
  if (!row) throw new Error('No such screening');
  return touch(id, { status: 'paused', position_ms: positionOf(row, now), started_at_ms: null });
}

/** Jump to a position on the subtitle timeline. Keeps playing if it was playing. */
export function seekClock(id: string, positionMs: number, now = Date.now()): Screening {
  const row = getScreening(id);
  if (!row) throw new Error('No such screening');
  return touch(id, {
    position_ms: Math.max(0, positionMs),
    started_at_ms: row.status === 'playing' ? now : null,
  });
}

/**
 * Resync. The file is cut against one release and the owner's service plays another, so
 * they drift. A NEGATIVE offset means the subtitle file runs ahead of the owner's
 * picture and needs holding back.
 */
export function resyncClock(id: string, offsetMs: number): Screening {
  return touch(id, { offset_ms: Math.round(offsetMs) });
}

export interface Scene {
  screeningId: string;
  title: string;
  status: ScreeningStatus;
  positionMs: number;
  lookbackMs: number;
  cues: Cue[];
  /** True when the clock has run past the last cue in the file. */
  pastEnd: boolean;
}

/**
 * What has just been said, and nothing else.
 *
 * Every cue returned has already started at or before the clock. There is no
 * parameter that lifts that and there is not going to be one — the guard is the
 * function, not an instruction sitting next to it.
 */
export function sceneAt(row: ScreeningRow, lookbackMs = DEFAULT_LOOKBACK_MS, now = Date.now()): Scene {
  const cues = cuesOf(row);
  const window = Math.min(Math.max(1_000, Math.round(lookbackMs)), MAX_LOOKBACK_MS);
  // The offset moves the subtitle timeline relative to the owner's picture, so it is
  // applied to the clock before anything is compared against a cue.
  const at = positionOf(row, now) + row.offset_ms;
  const floor = at - window;
  const visible = cues.filter((cue) => cue.startMs <= at && cue.endMs >= floor);
  return {
    screeningId: row.id,
    title: row.title,
    status: row.status,
    positionMs: positionOf(row, now),
    lookbackMs: window,
    cues: visible,
    pastEnd: at > subtitleDurationMs(cues),
  };
}

/**
 * Everything since we last looked, and it closes a hole nobody had seen:
 * sceneAt answers what is on screen AT THE INSTANT WE ASK, so every line
 * between one of the owner's messages and the next went past with nobody reading it.
 * We kept turning up to each turn having missed the middle.
 *
 * THE CLAMP IS UNTOUCHED AND CANNOT BE TOUCHED BY THIS. Only the FLOOR moves,
 * and a floor only ever reaches further BACKWARDS — into what the owner has already
 * watched. The ceiling is still positionOf(), so this is incapable of returning
 * a cue the owner has not reached, however large a gap it is asked to cover.
 *
 * It is for catching UP, not for reading OUT: the aim is to be on the same
 * page as the person watching, not to recite the dialogue back.
 */
export function sceneSince(row: ScreeningRow, sinceMs: number, now = Date.now()): Scene {
  const cues = cuesOf(row);
  const at = positionOf(row, now) + row.offset_ms;
  // A floor above the clock would be a gap asking to read forwards. Refuse it
  // by clamping rather than by trusting the caller.
  const floor = Math.min(Math.max(0, sinceMs), at);
  const visible = cues.filter((cue) => cue.startMs <= at && cue.endMs >= floor);
  return {
    screeningId: row.id,
    title: row.title,
    status: row.status,
    positionMs: positionOf(row, now),
    lookbackMs: Math.max(0, at - floor),
    cues: visible,
    pastEnd: at > subtitleDurationMs(cues),
  };
}

export function presentScreening(row: ScreeningRow, now = Date.now()): Screening {
  return present(row, now);
}
