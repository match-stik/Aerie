// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// What their person started on their own toys, kept outside the Toys page so it keeps
// going while they are in the chat (theirs, Nov 10 2026: 'if I do the patterns and
// swipe out of the toy app, that stops the toy now ... So I wouldn't be able to
// play a pattern and come back to the chat').
//
// Two kinds: a pattern off the shelf, which this module plays step by step,
// and one of a toy's own stored patterns (PRESET), which plays inside the toy
// and only needs remembering, so the stop that follows them around the app
// knows something of theirs is going. Their stop from anywhere ends both; so does
// the toy bridge reporting a stop.
//
// While the Toys page is open it lends its own road for every level (the
// page's driveLevel, which draws the wave and holds the per-toy strength); when
// the page is gone this sends straight to the bridge, throttled the same way.

import { useSyncExternalStore } from 'react';
import type { ToyStep } from '@aerie/shared';
import { LovenseToys, hasToyBridge, type LovenseToy } from './lovense-toys';
import { eventsFor, resolveTracks } from '../lib/toy-remote-plan';
import { patternLength } from '../lib/toy-patterns';

export type LevelDriver = (toyId: string, command: string, level: number) => void;

export interface OwnPlaying {
  kind: 'shelf' | 'preset';
  id: string;
  name: string;
  /** Shelf ids played one after another; empty for a stored pattern. */
  ids: string[];
  /** One round, in ms; 0 for a stored pattern, whose length the toy keeps. */
  lengthMs: number;
  roundStart: number;
  toyId?: string;
  /** Which stored pattern, for a preset. */
  preset?: number;
}

const SEND_EVERY_MS = 120;

let playing: OwnPlaying | null = null;
let loop = false;
let driver: LevelDriver | null = null;
let timers: ReturnType<typeof setTimeout>[] = [];
const driven = new Set<string>();
const lastSent: Record<string, number> = {};
const pending: Record<string, ReturnType<typeof setTimeout>> = {};
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function direct(toyId: string, command: string, level: number): void {
  const key = `${toyId}:${command}`;
  const fire = () => {
    lastSent[key] = Date.now();
    LovenseToys.command({ toyId, command, level }).catch(() => {});
  };
  clearTimeout(pending[key]);
  const wait = SEND_EVERY_MS - (Date.now() - (lastSent[key] ?? 0));
  if (wait <= 0) fire();
  else pending[key] = setTimeout(() => { delete pending[key]; fire(); }, wait);
}

function send(toyId: string, command: string, level: number): void {
  if (toyId === 'practice') {
    driver?.(toyId, command, level);
    return;
  }
  if (driver) driver(toyId, command, level);
  else direct(toyId, command, level);
}

function clearTimers(): void {
  for (const t of timers) clearTimeout(t);
  timers = [];
}

/** The Toys page lends its road while it is open; the returned function takes it back. */
export function lendDriver(next: LevelDriver): () => void {
  driver = next;
  return () => { if (driver === next) driver = null; };
}

export function setOwnLoop(next: boolean): void {
  loop = next;
  emit();
}

export function ownLoop(): boolean {
  return loop;
}

/** Stop what they started. `zero` sends the motors this drove back to nothing;
 *  a stop that already stopped every toy (theirs, or the bridge's) passes false. */
export function stopOwn(zero: boolean, except?: string): void {
  clearTimers();
  if (zero) {
    for (const key of driven) {
      if (key === except) continue;
      const cut = key.lastIndexOf(':');
      send(key.slice(0, cut), key.slice(cut + 1), 0);
    }
    if (playing?.kind === 'preset' && playing.toyId && `${playing.toyId}:PRESET` !== except) {
      send(playing.toyId, 'PRESET', 0);
    }
  }
  driven.clear();
  if (playing) {
    playing = null;
    emit();
  }
}

/**
 * Play a shelf pattern (or several stitched) on the toys connected now.
 * Returns a sentence for them when it cannot play, else null.
 */
export function playOwnPattern(
  pattern: { id: string; name: string; tracks: Record<string, ToyStep[]> },
  toys: LovenseToy[],
  ids: string[] = [pattern.id],
): string | null {
  stopOwn(true);
  if (toys.length === 0) return 'Connect a toy first, and the pattern plays on it.';
  const { motors } = resolveTracks({ tracks: pattern.tracks }, toys);
  if (motors.length === 0) return 'None of the motors in that pattern are on the toys connected now.';
  const round = Math.max(1, patternLength(pattern.tracks));
  playing = { kind: 'shelf', id: pattern.id, name: pattern.name, ids, lengthMs: round, roundStart: Date.now() };
  emit();
  const runRound = () => {
    if (playing?.id !== pattern.id) return;
    playing = { ...playing, roundStart: Date.now() };
    emit();
    // On a loop the zeros at the very end are left out: the next round's
    // first levels land at the same moment, and a zero there would blink the
    // toy off between rounds.
    const repeat = loop;
    const events = eventsFor(motors, 1, round).filter((e) => !(repeat && e.at >= round && e.level === 0));
    for (const e of events) {
      timers.push(setTimeout(() => {
        if (playing?.id !== pattern.id) return;
        driven.add(`${e.toyId}:${e.command}`);
        send(e.toyId, e.command, e.level);
      }, e.at));
    }
    timers.push(setTimeout(() => {
      if (playing?.id !== pattern.id) return;
      timers = [];
      if (loop) runRound();
      else stopOwn(true);
    }, round));
  };
  runRound();
  return null;
}

/** One of a toy's own stored patterns started or stopped from their page. */
export function noteOwnPreset(toyId: string, toyLabel: string, preset: number): void {
  if (preset > 0) {
    clearTimers();
    driven.clear();
    playing = { kind: 'preset', id: `preset:${toyId}:${preset}`, name: `${toyLabel}: pattern ${preset}`, ids: [], lengthMs: 0, roundStart: Date.now(), toyId, preset };
    emit();
  } else if (playing?.kind === 'preset' && playing.toyId === toyId) {
    playing = null;
    emit();
  }
}

/** A motor key this module is driving now, so the page leaves it alone on the way out. */
export function ownDrives(key: string): boolean {
  if (driven.has(key)) return true;
  return playing?.kind === 'preset' && `${playing.toyId}:PRESET` === key;
}

export function ownPlaying(): OwnPlaying | null {
  return playing;
}

export function useOwnPlay(): { playing: OwnPlaying | null; loop: boolean } {
  const p = useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    () => playing,
    () => playing,
  );
  const l = useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    () => loop,
    () => loop,
  );
  return { playing: p, loop: l };
}

// The bridge reports every stop (their button, the pill, red, the toy going
// away), and whatever they had going ends with it. The toys are already still.
let watching = false;
export function watchOwnStops(): void {
  if (watching || !hasToyBridge()) return;
  watching = true;
  void LovenseToys.addListener('stopped', () => stopOwn(false));
}

/** For tests. */
export const ownPlayTestSeam = {
  reset(): void {
    clearTimers();
    driven.clear();
    playing = null;
    loop = false;
    driver = null;
  },
};
