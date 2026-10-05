// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Following the owner without asking them.
//
// Before this, the clock was corrected by hand, and every one of those
// corrections was the same three moves: read the owner's phone, notice it said PAUSED,
// put the clock on that number. The owner never had to be asked, but a companion had
// to be awake and thinking about it.
//
// THE ONE THING THE PLAYER TELLS THE TRUTH ABOUT IS A PAUSE. Measured:
// while playing, Hulu publishes STREAM position with advert time folded
// in, and the instant the owner paused, it dropped five minutes and twenty-five
// seconds to the real one. Forty-two readings across a break and not one field
// moves, so an advert is invisible — but a pause is a free, exact calibration,
// and the owner pauses anyway.
//
// So this decides, from one reading, whether the house should move the clock.
// It is pure and it is deliberately timid: it would rather do nothing than act
// on a reading it does not fully understand.

import type { MediaSessionReading } from './db/media-session.js';

/** A reading older than this is a description of the past, not of the owner. */
export const MAX_ACTIONABLE_AGE_MS = 45_000;

export type FollowAction =
  | { kind: 'none'; reason: string }
  | { kind: 'anchor'; positionMs: number; reason: string }
  | { kind: 'resume'; reason: string };

export interface ScreeningView {
  /** 'playing' | 'paused' */
  status: string;
  /** The package this screening is following, once one has been learned. */
  followPackage: string | null;
}

/**
 * What to do about one reading.
 *
 * ANCHOR means the player just told the truth — put the clock there and hold
 * it. RESUME means the owner pressed play and our clock is still parked, so start it
 * WITHOUT touching the position: the anchor is trustworthy and the playing
 * number is not.
 */
export function followAction(
  reading: MediaSessionReading | null,
  screening: ScreeningView | null,
  ageMs: number,
): FollowAction {
  if (!screening) return { kind: 'none', reason: 'nothing loaded' };
  if (!reading) return { kind: 'none', reason: 'the phone has said nothing' };
  if (ageMs > MAX_ACTIONABLE_AGE_MS) return { kind: 'none', reason: 'reading too old to act on' };
  // A different app is a different evening. Never move the episode because a
  // podcast or a song reported a position.
  if (screening.followPackage && reading.package !== screening.followPackage) {
    return { kind: 'none', reason: `reading is from ${reading.package}, not the followed app` };
  }
  if (!reading.reportsPosition || typeof reading.positionMs !== 'number' || reading.positionMs < 0) {
    return { kind: 'none', reason: 'this player does not say where it is' };
  }

  if (reading.state === 'playing') {
    // The playing number carries advert time, so it is not an anchor. The only
    // thing worth acting on is that the owner has started again.
    return screening.status === 'playing'
      ? { kind: 'none', reason: 'already running with the owner' }
      : { kind: 'resume', reason: 'the owner pressed play' };
  }

  // Paused, stopped, buffering — the player is not counting, so the number is
  // the real one. This is the whole reason the feature works.
  return { kind: 'anchor', positionMs: reading.positionMs, reason: `the player is ${reading.state}` };
}
