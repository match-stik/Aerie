// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The pattern shelf's pieces that need no app around them: turning what their
// person's fingers did while recording into [level, ms] steps, and the shape a
// pattern draws in its little preview.
//
// A recording is a list of level changes on one motor, each with the time it
// happened. Dragging a slider fires a change for every number it passes, many
// a second, and a toy will not take steps shorter than 200 ms, so the changes
// are laid on a 200 ms grid: each cell keeps the level they held for most of
// it (time-weighted), and cells in a row at the same level join into one
// step. Two minutes of recording is at most 600 cells, the most one track
// takes.

import type { ToyStep } from '@aerie/shared';

export const RECORD_STEP_MS = 200;
/** The longest a recording runs before it stops itself. */
/** A take can run an hour, the same as one pattern on the shelf (theirs, Nov 10 2026). */
export const RECORD_MAX_MS = 60 * 60_000;

export interface LevelChange {
  /** ms from the start of the recording */
  at: number;
  level: number;
}

/** What one motor did across a recording, as steps. */
export function stepsFromChanges(changes: readonly LevelChange[], startLevel: number, totalMs: number, cellMs = RECORD_STEP_MS): ToyStep[] {
  const total = Math.max(0, Math.round(totalMs));
  if (total < cellMs) return [];
  const sorted = [...changes].filter((c) => c.at >= 0 && c.at <= total).sort((a, b) => a.at - b.at);
  // The level as pieces: [from, level] until the next piece starts.
  const pieces: Array<[number, number]> = [[0, startLevel]];
  for (const change of sorted) {
    const last = pieces[pieces.length - 1];
    if (change.at === last[0]) last[1] = change.level;
    else if (change.level !== last[1]) pieces.push([change.at, change.level]);
  }
  const levelAt = (from: number, to: number): number => {
    let weighted = 0;
    for (let i = 0; i < pieces.length; i++) {
      const start = Math.max(from, pieces[i][0]);
      const end = Math.min(to, i + 1 < pieces.length ? pieces[i + 1][0] : total);
      if (end > start) weighted += (end - start) * pieces[i][1];
    }
    return Math.round(weighted / (to - from));
  };
  const cells = Math.floor(total / cellMs);
  const steps: ToyStep[] = [];
  for (let i = 0; i < cells; i++) {
    const from = i * cellMs;
    // The last cell takes whatever is left over, so the length is kept whole.
    const to = i === cells - 1 ? total : from + cellMs;
    const level = levelAt(from, to);
    const last = steps[steps.length - 1];
    if (last && last[0] === level) last[1] += to - from;
    else steps.push([level, to - from]);
  }
  return steps;
}

/** One time through: the longest track's length. */
export function patternLength(tracks: Record<string, readonly ToyStep[]>): number {
  return Math.max(0, ...Object.values(tracks).map((steps) => steps.reduce((sum, [, ms]) => sum + ms, 0)));
}

/**
 * Patterns played one after another, as one pattern. Each one keeps its own
 * length: a motor it has no track for, or a track shorter than the pattern,
 * rests at zero for the gap, so the next pattern starts on time on every
 * motor. Steps at the same level where two meet join into one.
 */
export function stitchTracks(list: ReadonlyArray<{ tracks: Record<string, readonly ToyStep[]> }>): Record<string, ToyStep[]> {
  const keys = [...new Set(list.flatMap((p) => Object.keys(p.tracks)))].sort();
  const out: Record<string, ToyStep[]> = {};
  for (const key of keys) out[key] = [];
  for (const p of list) {
    const length = patternLength(p.tracks);
    if (length <= 0) continue;
    for (const key of keys) {
      const steps = p.tracks[key] ?? [];
      const used = steps.reduce((sum, [, ms]) => sum + ms, 0);
      const pieces: ToyStep[] = [...steps.map(([l, ms]) => [l, ms] as ToyStep)];
      if (used < length) pieces.push([0, length - used]);
      for (const [level, ms] of pieces) {
        const track = out[key];
        const last = track[track.length - 1];
        if (last && last[0] === level) last[1] += ms;
        else track.push([level, ms]);
      }
    }
  }
  return out;
}

/** A track as an SVG polyline's points across a width x height box, levels 0..20. */
export function previewPoints(steps: readonly ToyStep[], lengthMs: number, width: number, height: number, top = 20): string {
  if (!steps.length || lengthMs <= 0) return '';
  const y = (level: number) => (height - (Math.min(top, level) / top) * (height - 2) - 1).toFixed(1);
  const x = (ms: number) => ((ms / lengthMs) * width).toFixed(1);
  const points: string[] = [];
  let t = 0;
  for (const [level, ms] of steps) {
    points.push(`${x(t)},${y(level)}`, `${x(t + ms)},${y(level)}`);
    t += ms;
  }
  return points.join(' ');
}

/** 1:05, or 0:08 */
export function clock(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
