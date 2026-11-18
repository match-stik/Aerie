// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// How long a quiet stretch has to last before a voice turn is over.
//
// A long turn used to be cut where the speaker paused mid-story, and the reply
// started playing while they were still talking. A short answer and a
// long ramble pause differently: someone who has been talking a while stops to
// find the next thought, and that pause is longer than the gap after a quick
// reply. So the wait grows with how long they have been speaking, from the base
// silence up to a ceiling, and a quick turn still ends as fast as before.

export interface TurnSilenceOptions {
  /** The silence that ends a short turn. */
  baseMs: number;
  /** Speaking time after which the longer wait starts to apply. */
  longTurnAfterMs?: number;
  /** The most silence a turn will ever wait for. */
  longTurnSilenceMs?: number;
  /** Speaking time over which the wait climbs from base to the ceiling. */
  rampMs?: number;
}

/** Silence needed to end a turn that has been speaking for spokenMs. */
export function requiredSilenceMs(spokenMs: number, options: TurnSilenceOptions): number {
  const base = options.baseMs;
  const ceiling = options.longTurnSilenceMs;
  if (ceiling === undefined || ceiling <= base) return base;
  const after = options.longTurnAfterMs ?? 10_000;
  const ramp = Math.max(1, options.rampMs ?? 20_000);
  if (!(spokenMs > after)) return base;
  const share = Math.min(1, (spokenMs - after) / ramp);
  return Math.round(base + (ceiling - base) * share);
}
