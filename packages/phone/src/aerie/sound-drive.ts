// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// A sound on the shelf driving their toys in time with it (theirs, Nov 10 2026:
// 'hook up the wave form that the audio would make to control the wave of
// the toy'). The house works out the sound's loudness once
// (GET /api/toys/sounds/:id/envelope, a level every tenth of a second), and
// while they have this switched on and the sound plays, each connected toy's
// main motor follows it: up as fast as the sound gets loud, down gently.
//
// It is their own hand, the same as a slider, so it does not need the remote
// handed over. It steps aside while one of us is playing their toys or them
// fingers are on the orbs, and their stop switches it off. The phone leaving
// the app, the sound pausing or ending, and switching it off all send zeros.
// Every level still passes through each toy's strength setting on its way.

import { useSyncExternalStore } from 'react';
import { api } from './api';
import { LovenseToys, hasToyBridge, motorsFor } from './lovense-toys';
import { toyRemoteSnapshot } from './toy-remote';
import { soundState, soundTime } from '../lib/sound-player';
import { follow, lineAt, rollTowards } from '../lib/sound-drive-line';

const TICK_MS = 100;

let on = false;
let timer: ReturnType<typeof setInterval> | null = null;
let line: { soundId: string; stepMs: number; levels: number[] } | null = null;
let fetching: string | null = null;
/** The level each motor was last sent, keyed toyId:command. */
const sent = new Map<string, number>();
/** Each toy's motors in order: the first follows every syllable, any after
 *  it the slow swell of the sound, so on the Flexer the buzz chatters with
 *  the words while the curl rolls with the phrases (theirs, Nov 10 2026: it
 *  only did the vibration). */
let targets: { toyId: string; command: string; slow: boolean }[] = [];
let level = 0;
let swell = 0;
/** What the toys were last handed, for the page's wave to draw. */
let shown: Record<string, number> = {};
const levelListeners = new Set<() => void>();
function show(next: Record<string, number>): void {
  shown = next;
  for (const fn of levelListeners) fn();
}
let started = false;
const listeners = new Set<() => void>();
let snapshot = { on: false, problem: null as string | null };

function changed(patch: Partial<typeof snapshot>): void {
  snapshot = { ...snapshot, ...patch };
  for (const fn of listeners) fn();
}

async function refreshTargets(): Promise<void> {
  try {
    const { toys } = await LovenseToys.toys();
    targets = toys.filter((t) => t.connected).flatMap((t) =>
      motorsFor(t).map((m, i) => ({ toyId: t.toyId, command: m.command, slow: i > 0 })));
  } catch {
    targets = [];
  }
}

function sendAll(fast: number, slow: number): void {
  const next: Record<string, number> = {};
  for (const t of targets) {
    const key = `${t.toyId}:${t.command}`;
    const value = t.slow ? slow : fast;
    next[key] = value;
    if (sent.get(key) === value) continue;
    sent.set(key, value);
    void LovenseToys.command({ toyId: t.toyId, command: t.command, level: value }).catch(() => {});
  }
  show(next);
}

function zero(): void {
  level = 0;
  swell = 0;
  if (Object.keys(shown).length) show({});
  for (const [key, value] of sent) {
    if (value === 0) continue;
    const cut = key.lastIndexOf(':');
    void LovenseToys.command({ toyId: key.slice(0, cut), command: key.slice(cut + 1), level: 0 }).catch(() => {});
    sent.set(key, 0);
  }
}

async function loadLine(soundId: string): Promise<void> {
  if (fetching === soundId) return;
  fetching = soundId;
  try {
    const res = await api.get(`/api/toys/sounds/${encodeURIComponent(soundId)}/envelope`);
    const body = (await res.json().catch(() => ({}))) as { stepMs?: number; levels?: number[]; error?: string };
    if (fetching !== soundId) return;
    if (!Array.isArray(body.levels)) throw new Error(body.error || 'The house could not read that sound.');
    line = { soundId, stepMs: body.stepMs ?? 100, levels: body.levels };
    changed({ problem: null });
  } catch (error) {
    changed({ problem: error instanceof Error ? error.message : 'The house could not read that sound.' });
  } finally {
    if (fetching === soundId) fetching = null;
  }
}

function tick(): void {
  const player = soundState();
  if (!player.id) {
    zero();
    return;
  }
  if (!line || line.soundId !== player.id) {
    zero();
    void loadLine(player.id);
    return;
  }
  const remote = toyRemoteSnapshot();
  // One of us playing, or their fingers on the orbs: those win, and we stay out of the way.
  if (remote.playing || remote.hands) {
    sent.clear();
    level = 0;
    return;
  }
  if (!player.playing) {
    zero();
    return;
  }
  const target = lineAt(line.levels, line.stepMs, soundTime());
  level = follow(level, target);
  swell = rollTowards(swell, target);
  sendAll(level, Math.round(swell));
}

export function setSoundDrive(next: boolean): void {
  if (next === on) return;
  on = next;
  if (on) {
    void refreshTargets();
    timer = setInterval(tick, TICK_MS);
  } else {
    if (timer) clearInterval(timer);
    timer = null;
    zero();
  }
  changed({ on });
}

/** The levels the sound is giving each motor right now, keyed toyId:command. */
export function useSoundDriveLevels(): Record<string, number> {
  return useSyncExternalStore(
    (fn) => { levelListeners.add(fn); return () => { levelListeners.delete(fn); }; },
    () => shown,
    () => shown,
  );
}

export function useSoundDrive(): typeof snapshot {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    () => snapshot,
    () => snapshot,
  );
}

/** Once, when the app starts: their stop, a toy coming or going, and the app leaving the screen. */
export function startSoundDrive(): void {
  if (started || typeof window === 'undefined' || !hasToyBridge()) return;
  started = true;
  void LovenseToys.addListener('stopped', () => setSoundDrive(false));
  void LovenseToys.addListener('connection', () => { if (on) void refreshTargets(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && on) zero();
  });
}
