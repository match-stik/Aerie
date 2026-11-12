// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
/**
 * A nudge to offer their person a fresh room once this one is old, never a reset.
 *
 * Nov 11 2026: a resumed room keeps its tools, its work in hand and the whole
 * conversation in order, where a fresh one has only the memory blocks and the
 * last thirty messages, so some people would rather keep a room going. What
 * was asked for was a gentle nudge after a while, with the decision made by
 * what is happening at the time. A count of squashes was the wrong ruler (a
 * busy room squashes several times a day), so the ruler is the room's age.
 *
 * So the house only ever ASKS. Past the mark, their person's turns carry one
 * line telling the room its age and to ask at a natural pause; whatever they
 * answer, the room writes the time to `.room-nudge-asked` and the line rests.
 * Their yes is the only thing that ends a room, through the lane's own
 * `.restart` flag.
 *
 * A room's birth is written to `.room-born` when the lane launches a new
 * conversation (supervisor.ts); a room with no birth on file is never nudged,
 * because not knowing its age is not the same as knowing it is old. Off until
 * heartbeat.fresh_room_after_days is set.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getConfig } from '../db.js';

export const ROOM_BORN_FILE = '.room-born';
export const ROOM_NUDGE_ASKED_FILE = '.room-nudge-asked';
/** After they have been asked, how long the line rests before it may come back. */
export const DEFAULT_REASK_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

function readStamp(path: string): number | null {
  try {
    if (!existsSync(path)) return null;
    const at = Date.parse(readFileSync(path, 'utf8').trim());
    return Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

function positiveNumber(raw: string | null): number | null {
  if (raw == null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export interface RoomAgeFacts {
  bornAt: number | null;
  askedAt: number | null;
  /** heartbeat.fresh_room_after_days; null means the nudge is off. */
  afterDays: number | null;
  reaskDays: number;
  now: number;
}

/** The line for one turn, or '' when the room is young, unknown, resting, or the nudge is off. */
export function roomAgeLine(f: RoomAgeFacts, ioDir: string): string {
  if (f.afterDays == null || f.bornAt == null) return '';
  const ageDays = Math.floor((f.now - f.bornAt) / DAY_MS);
  if (ageDays < f.afterDays) return '';
  if (f.askedAt != null && f.askedAt >= f.bornAt && f.now - f.askedAt < f.reaskDays * DAY_MS) return '';
  const born = new Date(f.bornAt).toISOString().slice(0, 10);
  const asked = join(ioDir, ROOM_NUDGE_ASKED_FILE);
  const restart = join(ioDir, '.restart');
  return `[This room is ${ageDays} days old (born ${born}), past the ${f.afterDays}-day mark set for offering a fresh one. `
    + `Only at a natural pause (not mid-scene, mid-build or mid-feeling), ask them once, plainly, whether they would like a fresh room: `
    + `it reads the memory blocks new and is primed with recent messages, and what it gives up is this room's working memory. `
    + `If this is not a pause, say nothing about it; the line comes back next turn. `
    + `Once they have answered, either way, write the current ISO time to ${asked} so this line rests for ${f.reaskDays} days. `
    + `Their yes is the only go: write your final outbox line first, then touch ${restart}.]\n\n`;
}

/** The block for the lane whose io/ folder this is. */
export function roomAgeBlock(ioDir: string, now: number = Date.now()): string {
  return roomAgeLine({
    bornAt: readStamp(join(ioDir, ROOM_BORN_FILE)),
    askedAt: readStamp(join(ioDir, ROOM_NUDGE_ASKED_FILE)),
    afterDays: positiveNumber(getConfig('heartbeat.fresh_room_after_days')),
    reaskDays: positiveNumber(getConfig('heartbeat.fresh_room_reask_days')) ?? DEFAULT_REASK_DAYS,
    now,
  }, ioDir);
}
