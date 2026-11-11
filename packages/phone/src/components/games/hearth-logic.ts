// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Core Defense's rules: a fire in a clearing, things coming out of the dark,
// and the night told in hours.
//
// The field is 340 by 453 points with the fire at its centre. Nothing here
// touches the canvas, so the rules can be tested on their own.

export const FIELD_W = 340;
export const FIELD_H = 453;
export const CX = FIELD_W / 2;
export const CY = FIELD_H / 2;
/** How close something can get before the fire goes out. */
export const FIRE_R = 20;
export const EMBER_SPEED = 6;
/** Frames between embers while the pad is held. */
export const EMBER_EVERY = 8;
/** A disguised wisp breaks open this close to the fire. */
export const WISP_SPLIT_AT = 100;
export const STEP_MS = 1000 / 60;

export type Kind = 'shade' | 'moth' | 'creep' | 'wisp';

export const POINTS: Record<Kind, number> = { shade: 10, moth: 15, creep: 20, wisp: 25 };

/** The night, one hour a wave. Past the last one it is simply toward dawn. */
export const HOURS = ['Dusk', '9 PM', '10 PM', '11 PM', 'Midnight', '1 AM', '2 AM', '3 AM', '4 AM'];

export function hourName(wave: number): string {
  return HOURS[wave - 1] ?? 'Toward dawn';
}

export interface Wave {
  count: number;
  /** Frames between arrivals. */
  every: number;
  speed: number;
  kinds: Kind[];
}

export function waveFor(n: number): Wave {
  const w = Math.max(1, n);
  const kinds: Kind[] = ['shade', 'shade', 'moth'];
  if (w >= 2) kinds.push('creep');
  if (w >= 3) kinds.push('wisp');
  if (w >= 5) kinds.push('moth', 'wisp');
  return {
    count: Math.min(40, 6 + w * 3),
    every: Math.max(18, 72 - w * 6),
    speed: Math.min(1.6, 0.55 + w * 0.08),
    kinds,
  };
}

export function pickKind(wave: Wave, random: number): Kind {
  return wave.kinds[Math.min(wave.kinds.length - 1, Math.floor(random * wave.kinds.length))];
}

/** Clearing a wave is worth this much on top of what was hit. */
export function waveBonus(n: number): number {
  return 50 * n;
}

/** Where something steps out of the dark: just past whichever edge lies at that angle from the fire. */
export function spawnPoint(angle: number): { x: number; y: number } {
  const c = Math.abs(Math.cos(angle));
  const s = Math.abs(Math.sin(angle));
  const toEdge = Math.min(c > 1e-6 ? CX / c : Infinity, s > 1e-6 ? CY / s : Infinity);
  const r = toEdge + 22;
  return { x: CX + Math.cos(angle) * r, y: CY + Math.sin(angle) * r };
}

/** Kills within this many frames of each other keep a chain going. */
export const CHAIN_WINDOW = 90;

/** One extra point-multiple for every five in a chain, up to four times. */
export function chainMultiplier(chain: number): number {
  return Math.min(4, 1 + Math.floor(chain / 5));
}

export const FLARE_PER_KILL = 0.1;
export const FLARE_RADIUS = 150;

export function chargeFlare(charge: number): number {
  return Math.min(1, charge + FLARE_PER_KILL);
}

/** The firelight pulls in as the nearest thing closes on it. */
export function lightRadius(nearest: number): number {
  const t = Math.min(1, Math.max(0, (nearest - 40) / 180));
  return 70 + t * 90;
}

export function reachesFire(x: number, y: number, r: number): boolean {
  return Math.hypot(x - CX, y - CY) < FIRE_R + r;
}

export function emberHits(ex: number, ey: number, x: number, y: number, r: number): boolean {
  return Math.hypot(ex - x, ey - y) < r + 3;
}

export function offField(x: number, y: number, margin = 30): boolean {
  return x < -margin || y < -margin || x > FIELD_W + margin || y > FIELD_H + margin;
}
