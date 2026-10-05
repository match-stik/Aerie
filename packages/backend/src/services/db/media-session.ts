// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// What the owner's phone says is playing.
//
// The phone reads Android's media session and posts it here. Nothing in this
// file decides anything — it stores what arrived and hands it back. The
// decisions (is this the episode or an advert, should the clock follow) are
// deliberately somewhere else, because at the time of writing NOBODY KNOWS
// what a player publishes during an advert break, and a storage layer is a
// terrible place to guess.

import { randomUUID } from 'node:crypto';
import { getDb } from './index.js';

export interface MediaSessionReading {
  id: string;
  package: string;
  state: string;
  reportsPosition: boolean;
  positionMs: number | null;
  livePositionMs: number | null;
  durationMs: number | null;
  speed: number | null;
  title: string | null;
  receivedAtMs: number;
}

interface Row {
  id: string;
  package: string;
  state: string;
  reports_position: number;
  position_ms: number | null;
  live_position_ms: number | null;
  duration_ms: number | null;
  speed: number | null;
  title: string | null;
  received_at_ms: number;
}

/** Keep enough to read an advert break end to end, and no more. */
export const KEEP_READINGS = 500;

const toReading = (r: Row): MediaSessionReading => ({
  id: r.id,
  package: r.package,
  state: r.state,
  reportsPosition: !!r.reports_position,
  positionMs: r.position_ms,
  livePositionMs: r.live_position_ms,
  durationMs: r.duration_ms,
  speed: r.speed,
  title: r.title,
  receivedAtMs: r.received_at_ms,
});

export interface IncomingReading {
  package?: unknown;
  state?: unknown;
  reportsPosition?: unknown;
  positionMs?: unknown;
  livePositionMs?: unknown;
  durationMs?: unknown;
  speed?: unknown;
  title?: unknown;
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/**
 * Store one reading. Returns null when there is nothing worth storing — an
 * absent package is not a reading, it is a phone with nothing playing, and
 * writing a row for it would bury the last real one under silence.
 */
export function recordReading(
  incoming: IncomingReading,
  now = Date.now(),
): MediaSessionReading | null {
  const pkg = typeof incoming.package === 'string' ? incoming.package.trim() : '';
  if (!pkg) return null;
  const row: Row = {
    id: randomUUID(),
    package: pkg,
    state: typeof incoming.state === 'string' && incoming.state ? incoming.state : 'none',
    reports_position: incoming.reportsPosition ? 1 : 0,
    position_ms: num(incoming.positionMs),
    live_position_ms: num(incoming.livePositionMs),
    duration_ms: num(incoming.durationMs),
    speed: num(incoming.speed),
    title: typeof incoming.title === 'string' && incoming.title ? incoming.title : null,
    received_at_ms: now,
  };
  const db = getDb();
  db.prepare(
    `INSERT INTO media_session_readings
       (id, package, state, reports_position, position_ms, live_position_ms,
        duration_ms, speed, title, received_at_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id, row.package, row.state, row.reports_position, row.position_ms,
    row.live_position_ms, row.duration_ms, row.speed, row.title,
    row.received_at_ms, new Date(now).toISOString(),
  );
  db.prepare(
    `DELETE FROM media_session_readings
      WHERE id NOT IN (
        SELECT id FROM media_session_readings ORDER BY received_at_ms DESC LIMIT ?
      )`,
  ).run(KEEP_READINGS);
  return toReading(row);
}

export function latestReading(): MediaSessionReading | null {
  const row = getDb()
    .prepare('SELECT * FROM media_session_readings ORDER BY received_at_ms DESC LIMIT 1')
    .get() as Row | undefined;
  return row ? toReading(row) : null;
}

export function recentReadings(limit = 40): MediaSessionReading[] {
  const rows = getDb()
    .prepare('SELECT * FROM media_session_readings ORDER BY received_at_ms DESC LIMIT ?')
    .all(Math.min(Math.max(1, Math.round(limit)), KEEP_READINGS)) as Row[];
  return rows.map(toReading);
}

/**
 * How old a reading is, and whether it is old enough to stop believing.
 *
 * A stale reading is not a small error. A position from four minutes ago,
 * treated as current, puts the clock four minutes behind and looks exactly
 * like a correct clock to anybody reading it — so staleness is reported
 * beside every reading rather than left for a caller to work out.
 */
export const STALE_AFTER_MS = 60_000;

export function ageOf(reading: MediaSessionReading, now = Date.now()): number {
  return Math.max(0, now - reading.receivedAtMs);
}

export function isStale(reading: MediaSessionReading, now = Date.now()): boolean {
  return ageOf(reading, now) > STALE_AFTER_MS;
}
