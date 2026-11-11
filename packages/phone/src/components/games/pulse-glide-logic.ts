// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Signal Glide's rules, kept apart from the canvas so they can be tested.
//
// The field is 340 by 453 points. The glider sits at a fixed x and only moves
// up and down; gates scroll in from the right. Everything here is plain
// numbers, so the same daily seed lays out the same course on every phone.

export const FIELD_W = 340;
export const FIELD_H = 453;
export const GLIDER_X = 64;
export const GLIDER_R = 6;
export const GATE_W = 14;
export const GRAVITY = 0.15;
export const BOOST = -4;
/** Physics runs at this rate whatever the screen refreshes at, so a 120 Hz phone isn't twice as hard. */
export const STEP_MS = 1000 / 60;

export interface Difficulty {
  speed: number;
  gap: number;
  /** Frames between gates. */
  spawnEvery: number;
}

/** Ten gates to a level. Level 1 plays like the old game; it tops out at 8. */
export const GATES_PER_LEVEL = 10;
export const MAX_LEVEL = 8;

export function levelFor(gatesPassed: number): number {
  return Math.min(MAX_LEVEL, 1 + Math.floor(gatesPassed / GATES_PER_LEVEL));
}

export function difficultyFor(level: number): Difficulty {
  const step = Math.min(MAX_LEVEL, Math.max(1, level)) - 1;
  return {
    speed: 2 + step * 0.22,
    gap: 140 - step * 7,
    spawnEvery: Math.round(120 - step * 6),
  };
}

/** A gate counts as clean when the glider crosses within this share of the gap's middle. */
export const CLEAN_BAND = 0.22;

export function isCleanPass(gliderY: number, gapTop: number, gapBottom: number): boolean {
  const gap = gapBottom - gapTop;
  const centre = gapTop + gap / 2;
  return Math.abs(gliderY - centre) <= gap * CLEAN_BAND;
}

/**
 * Points for one gate. A plain pass is worth 1 and breaks the streak. A clean
 * pass is worth 1 plus the streak it extends, up to 4 extra, so holding the
 * middle is how the big numbers happen.
 */
export function scoreGate(streak: number, clean: boolean): { points: number; streak: number } {
  if (!clean) return { points: 1, streak: 0 };
  const next = streak + 1;
  return { points: 1 + Math.min(next, 4), streak: next };
}

export function hitsGate(gliderY: number, gateX: number, gapTop: number, gapBottom: number): boolean {
  const overlapsX = GLIDER_X + GLIDER_R > gateX && GLIDER_X - GLIDER_R < gateX + GATE_W;
  if (!overlapsX) return false;
  return gliderY - GLIDER_R < gapTop || gliderY + GLIDER_R > gapBottom;
}

export function hitsBounds(gliderY: number): boolean {
  return gliderY - GLIDER_R < 0 || gliderY + GLIDER_R > FIELD_H;
}

/** Where the next gap opens, given a random number in [0, 1). */
export function gapTopFor(random: number, gap: number): number {
  const margin = 46;
  return margin + random * (FIELD_H - gap - margin * 2);
}

/** mulberry32: small, fast, and the same sequence everywhere for the same seed. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The day's course, by the phone's own calendar date. */
export function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function seedForDay(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export type TrailId = 'spark' | 'comet' | 'ribbon' | 'aurora' | 'prism';

export interface Trail {
  id: TrailId;
  name: string;
  /** Best score that unlocks it. */
  unlockAt: number;
}

export const TRAILS: Trail[] = [
  { id: 'spark', name: 'Spark', unlockAt: 0 },
  { id: 'comet', name: 'Comet', unlockAt: 20 },
  { id: 'ribbon', name: 'Ribbon', unlockAt: 50 },
  { id: 'aurora', name: 'Aurora', unlockAt: 100 },
  { id: 'prism', name: 'Prism', unlockAt: 175 },
];

export function unlockedTrails(best: number): TrailId[] {
  return TRAILS.filter((t) => best >= t.unlockAt).map((t) => t.id);
}

/** Trails a run just opened: unlocked by the new best but not by the old one. */
export function newlyUnlocked(oldBest: number, newBest: number): Trail[] {
  return TRAILS.filter((t) => t.unlockAt > oldBest && t.unlockAt <= newBest);
}
