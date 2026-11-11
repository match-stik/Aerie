// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Loop on the orbs: what one finger did from touch to lift, replayed in a
// circle until they touch that orb again (components/ToyOrbs.tsx).
// Kept free of imports so it can be tested without the app around it.

export interface Sample { at: number; x: number; y: number; level: number }

/** Where a loop is at this moment: the last sample at or before its offset
 *  into the loop, so a level is held until the finger had changed it. */
export function loopSample(samples: Sample[], start: number, length: number, now: number): Sample {
  const first = samples[0];
  const offset = length > 0 ? (now - start) % length : 0;
  let hit = first;
  for (const sample of samples) {
    if (sample.at - first.at <= offset) hit = sample;
    else break;
  }
  return hit;
}
