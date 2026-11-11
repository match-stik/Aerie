// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// How a sound's loudness line becomes a toy's level from one moment to the
// next (aerie/sound-drive.ts drives it). Speech jumps about every tenth of a
// second, so the level rises as fast as the sound does and falls back
// slowly, and the toy feels a wave rather than a stutter.
// Kept free of imports so it can be tested without the app around it.

/** The line's level at a moment in the sound. */
export function lineAt(levels: readonly number[], stepMs: number, seconds: number): number {
  if (levels.length === 0 || !Number.isFinite(seconds) || seconds < 0) return 0;
  const i = Math.floor((seconds * 1000) / stepMs);
  return i >= levels.length ? 0 : Math.max(0, Math.min(20, levels[i] ?? 0));
}

/** Rises at once, falls at most this much a tick. */
export const FALL_PER_TICK = 2;

export function follow(previous: number, target: number): number {
  if (target >= previous) return target;
  return Math.max(target, previous - FALL_PER_TICK);
}

/** A slow follower for a second motor: moves a sixth of the way to the
 *  sound each tick, so it rides the swell of a phrase rather than each word. */
export const SWELL_SHARE = 1 / 6;

export function rollTowards(previous: number, target: number): number {
  return previous + (target - previous) * SWELL_SHARE;
}
