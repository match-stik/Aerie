// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Lovense: this file drives Lovense toys. Running Aerie needs your own Lovense
// developer account and token; carrying this code into another project needs
// that project's own agreement and approval from Lovense. See
// packages/phone/android/LOVENSE.md.
// The phone's half of the road from a lane to the owner's toys, and the side
// that keeps the owner safe on it, because this is where their hands are.
//
// A companion's command arrives over the socket (toy_command). It reaches a
// toy only when all of these hold, checked here and nowhere else:
//   - the owner has handed the remote over on the Toys page, and has not
//     taken it back, pressed a stop anywhere, or typed red since (it starts closed
//     every time the app starts);
//   - the screen is on and the app is in front (leaving it stops the lane);
//   - the owner does not have the orbs open, driving by hand;
//   - the owner's own stop is not still holding.
// Every command ends on its own at its maxMs, and every way of ending sends
// zeros to whatever it was driving. The owner moving a slider takes that
// motor off the lane at once. The phone answers each command (POST /api/toys/ack) with
// what it actually did, so a lane can only ever write about a toy what is
// really happening to it.
//
// A light command passes the same four checks and the owner's stop's hold, and then
// only switches a toy's light: it never touches what is playing.
//
// Only a phone that can reach toys answers, so a laptop with the app open
// never speaks for the owner.

import { useSyncExternalStore } from 'react';
import type { ToyPhoneState, ToyPhoneToy, ToyRemoteAck, ToyRemoteCommand, ToyRemotePlaying } from '@aerie/shared';
import { api } from './api';
import { LovenseToys, hasToyBridge, motorsFor, presetsFor, stopAllToys, type LovenseToy } from './lovense-toys';
import { startToyConnectWatch } from './toy-connect';
import { admitCommand } from '../lib/toy-command-admit';
import { batteryFields, createBatteryWatch, type BatteryReading } from '../lib/toy-battery';
import { lightsFor, runLight } from '../lib/toy-light';
import { eventsFor, presetTargets, resolveTracks, type ToyEvent } from '../lib/toy-remote-plan';
import { toyName } from '../lib/toy-names';

export type GateClosedBy = NonNullable<ToyPhoneState['closedBy']>;

export interface ToyRemoteSnapshot {
  bridge: boolean;
  gate: 'open' | 'closed';
  closedBy: GateClosedBy | null;
  gateChangedAt: string | null;
  away: boolean;
  hands: boolean;
  playing: ToyRemotePlaying | null;
}

/** A command older than this when it lands is refused: the house stopped
 *  waiting for it long before, and the lane was told nothing happened. */
const STALE_MS = 60_000;

interface Driven {
  toyId: string;
  command: string;
  label: string;
  level: number;
}

interface Playback {
  commandId: string;
  companion: string;
  startedAt: number;
  endsAt: number;
  /** Keyed toyId:command. A motor the owner takes back leaves this map. */
  driven: Map<string, Driven>;
  timers: ReturnType<typeof setTimeout>[];
  preset?: number;
}

let snap: ToyRemoteSnapshot = {
  bridge: false,
  gate: 'closed',
  closedBy: 'fresh',
  gateChangedAt: null,
  away: false,
  hands: false,
  playing: null,
};
let playback: Playback | null = null;
/** What the decisions and the reports reach the toys through: the app's
 *  bridge, or a stand-in a test hands over (toyRemoteTestSeam). */
type Bridge = Pick<typeof LovenseToys, 'toys' | 'command'>;
let bridge: Bridge = LovenseToys;
const listeners = new Set<() => void>();
/** Each toy's own battery answers, and the asking: a beat after it connects,
 *  and every minute while the remote is handed over or the Toys page is open
 *  (lib/toy-battery.ts says why the SDK's own field went stale). */
const batteries = createBatteryWatch({
  ask: (toyId) => bridge.command({ toyId, command: 'GET_BATTERY' }),
  connectedToyIds: async () => (await bridge.toys()).toys.filter((toy) => toy.connected).map((toy) => toy.toyId),
  now: () => Date.now(),
  every: (fn, ms) => setInterval(fn, ms),
  cancelEvery: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
  later: (fn, ms) => setTimeout(fn, ms),
});
let started = false;
let reportTimer: ReturnType<typeof setTimeout> | null = null;
let queue: Promise<void> = Promise.resolve();
let wakeLock: { release: () => Promise<void> } | null = null;

const iso = (ms: number = Date.now()) => new Date(ms).toISOString();

function playingNow(): ToyRemotePlaying | null {
  if (!playback) return null;
  return {
    companion: playback.companion,
    commandId: playback.commandId,
    startedAt: iso(playback.startedAt),
    endsAt: iso(playback.endsAt),
    motors: [...playback.driven.values()].map((d) => ({ toyId: d.toyId, command: d.command, label: d.label, level: d.level })),
    ...(playback.preset ? { preset: playback.preset } : {}),
  };
}

function setSnap(patch: Partial<ToyRemoteSnapshot>, tellHouse: boolean): void {
  snap = { ...snap, ...patch };
  // While the remote is handed over the levels are kept fresh for whoever reads them.
  if (snap.bridge) batteries.want('remote', snap.gate === 'open');
  for (const fn of listeners) fn();
  if (tellHouse) scheduleReport();
}

/** A level moved: the page and the pill redraw; the house is not told every step. */
function redraw(): void {
  setSnap({ playing: playingNow() }, false);
}

export function useToyRemote(): ToyRemoteSnapshot {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => snap,
    () => snap,
  );
}

export function toyRemoteSnapshot(): ToyRemoteSnapshot {
  return snap;
}

/** Every toy's last battery answer, for the Toys page to draw. */
export function useToyBatteries(): Readonly<Record<string, BatteryReading>> {
  return useSyncExternalStore(batteries.subscribe, batteries.view, batteries.view);
}

/** The Toys page is open: keep the levels fresh until the returned release. */
export function watchToyBatteries(): () => void {
  batteries.want('page', true);
  return () => batteries.want('page', false);
}

// ---- sending ----

function isHeld(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'HELD';
}

function send(toyId: string, command: string, level: number): Promise<'ok' | 'held' | 'failed'> {
  return bridge.command({ toyId, command, level }).then(
    () => 'ok' as const,
    (error) => (isHeld(error) ? ('held' as const) : ('failed' as const)),
  );
}

/** A command that takes no level, a light's. The bridge refuses it while the owner's stop holds. */
function sendPlain(toyId: string, command: string): Promise<'ok' | 'held' | 'failed'> {
  return bridge.command({ toyId, command }).then(
    () => 'ok' as const,
    (error) => (isHeld(error) ? ('held' as const) : ('failed' as const)),
  );
}

async function apply(pb: Playback, event: ToyEvent): Promise<'ok' | 'held' | 'failed' | 'skipped'> {
  const driven = pb.driven.get(`${event.toyId}:${event.command}`);
  if (!driven || playback !== pb) return 'skipped';
  driven.level = event.level;
  redraw();
  return send(event.toyId, event.command, event.level);
}

// ---- the screen stays on while a lane plays ----

async function holdScreen(): Promise<void> {
  if (wakeLock) return;
  try {
    const nav = navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> } };
    if (nav.wakeLock) wakeLock = await nav.wakeLock.request('screen');
  } catch {
    // Without it the screen may sleep, and sleeping stops the lane; that is the safe way round.
  }
}

function releaseScreen(): void {
  const held = wakeLock;
  wakeLock = null;
  if (held) void held.release().catch(() => {});
}

// ---- ending ----

/** Stop whatever a lane had playing. zero: send each motor its zero (false
 *  when the owner's own stop has already zeroed everything natively). */
function endPlayback(zero: boolean): void {
  const ending = playback;
  if (!ending) return;
  playback = null;
  for (const t of ending.timers) clearTimeout(t);
  if (zero) {
    for (const d of ending.driven.values()) if (d.level !== 0) void send(d.toyId, d.command, 0);
  }
  releaseScreen();
  setSnap({ playing: null }, true);
}

// ---- playing ----

function closedDetail(by: GateClosedBy | null): string {
  switch (by) {
    case 'stop':
      return 'The owner pressed stop. Nothing reaches the toys until they hand the remote back on the Toys page.';
    case 'red':
      return 'The owner said red. Everything is stopped, and the remote stays with them until they hand it back.';
    case 'owner':
      return 'The owner took the remote back.';
    default:
      return 'The owner has not handed you the remote. It is handed over from the Toys page.';
  }
}

function motorList(toys: LovenseToy[]): string {
  return toys
    .map((toy) => `${toyName(toy)} (${motorsFor(toy).map((m) => `${m.command} "${m.label.toLowerCase()}"`).join(', ')})`)
    .join('; ');
}

async function play(command: ToyRemoteCommand, toys: LovenseToy[]): Promise<ToyRemoteAck> {
  const id = command.id;
  let driven: Driven[];
  let events: ToyEvent[];
  let unmatched: string[] = [];

  if (command.preset) {
    const n = command.preset;
    const targets = presetTargets(command, toys);
    if (targets.length === 0) {
      return { id, ok: false, reason: 'no-toy', detail: `None of the toys connected on the owner's phone keeps a pattern ${n}.` };
    }
    driven = targets.map((toy) => ({ toyId: toy.toyId, command: 'PRESET', label: `pattern ${n}`, level: 0 }));
    events = [
      ...targets.map((toy) => ({ at: 0, toyId: toy.toyId, command: 'PRESET', level: n })),
      ...targets.map((toy) => ({ at: command.maxMs, toyId: toy.toyId, command: 'PRESET', level: 0 })),
    ];
  } else {
    const resolved = resolveTracks(command, toys);
    if (resolved.motors.length === 0) {
      return { id, ok: false, reason: 'no-toy', detail: `No motor by that name on the connected toys. Connected: ${motorList(toys)}.` };
    }
    unmatched = resolved.unmatched;
    driven = resolved.motors.map((m) => ({ toyId: m.toyId, command: m.command, label: m.label.toLowerCase(), level: 0 }));
    events = eventsFor(resolved.motors, command.loops ?? 1, command.maxMs);
  }

  // Hand over from what was playing: a motor the new command does not drive
  // goes to zero now, and one it does just moves to its new level.
  const before = playback;
  const keep = new Set(driven.map((d) => `${d.toyId}:${d.command}`));
  if (before) {
    for (const t of before.timers) clearTimeout(t);
    for (const [key, d] of before.driven) if (!keep.has(key) && d.level !== 0) void send(d.toyId, d.command, 0);
  }
  const now = Date.now();
  const next: Playback = {
    commandId: id,
    companion: command.companion,
    startedAt: now,
    endsAt: now + command.maxMs,
    driven: new Map(driven.map((d) => {
      const key = `${d.toyId}:${d.command}`;
      return [key, { ...d, level: before?.driven.get(key)?.level ?? 0 }];
    })),
    timers: [],
    ...(command.preset ? { preset: command.preset } : {}),
  };
  playback = next;

  // The first changes go now, and they are the answer: if the owner's stop is still
  // holding, nothing moved and the lane is told so.
  const first = await Promise.all(events.filter((e) => e.at === 0).map((e) => apply(next, e)));
  if (first.includes('held')) {
    if (playback === next) endPlayback(false);
    return { id, ok: false, reason: 'held', detail: 'The owner\'s stop is still holding. Nothing moved.' };
  }
  if (playback !== next) {
    return { id, ok: true, playing: playingNow(), detail: 'A newer command replaced this one as it started.' };
  }

  const byTime = new Map<number, ToyEvent[]>();
  for (const event of events) {
    if (event.at <= 0) continue;
    const group = byTime.get(event.at) ?? [];
    group.push(event);
    byTime.set(event.at, group);
  }
  for (const [at, group] of byTime) {
    next.timers.push(setTimeout(() => {
      for (const event of group) void apply(next, event);
    }, at));
  }
  // The end, whatever the steps said: zeros to anything still above zero.
  next.timers.push(setTimeout(() => {
    if (playback === next) endPlayback(true);
  }, command.maxMs + 60));

  void holdScreen();
  setSnap({ playing: playingNow() }, true);
  return {
    id,
    ok: true,
    playing: playingNow(),
    ...(unmatched.length ? { detail: `${unmatched.join(', ')} matched no motor on the connected toys; the rest is playing. Connected: ${motorList(toys)}.` } : {}),
  };
}

async function decide(command: ToyRemoteCommand): Promise<ToyRemoteAck> {
  const id = command.id;
  // Stopping is always allowed, whatever else is true, a late stop included:
  // it used to be refused as stale before it got here (found in an outside
  // audit), which left the play it was meant to end still running.
  const admitted = admitCommand(command, Date.now(), STALE_MS);
  if (admitted === 'stop') {
    const had = playback !== null;
    endPlayback(true);
    return { id, ok: true, playing: null, detail: had ? 'Stopped what was playing.' : 'Nothing of yours was playing.' };
  }
  if (admitted === 'stale') {
    return { id, ok: false, reason: 'bad', detail: `It reached the owner's phone long after it was sent, so it was not ${command.action === 'light' ? 'sent to their toys' : 'played'}.` };
  }
  const refused = refusalNow(id);
  if (refused) return refused;
  let toys: LovenseToy[] = [];
  try {
    toys = (await bridge.toys()).toys.filter((toy) => toy.connected);
  } catch {
    toys = [];
  }
  if (toys.length === 0) return { id, ok: false, reason: 'no-toy', detail: 'No toy is connected on the owner\'s phone.' };
  // Asked again after the wait for the toy list: Take it back, the orbs or
  // leaving the app during it would otherwise be overruled by a play that had
  // already been decided (found in an outside audit). Nothing in play() waits
  // before it starts, so this is the last word.
  const refusedLate = refusalNow(id);
  if (refusedLate) return refusedLate;
  // A light is sent and answered here, and play() and what is playing are
  // never reached: runLight is handed the plain sender and nothing else.
  if (command.action === 'light' && command.light) {
    return runLight(
      { id, toyId: command.toyId, light: command.light },
      toys.map((toy) => ({ toyId: toy.toyId, name: toyName(toy), commands: toy.commands })),
      sendPlain,
    );
  }
  return play(command, toys);
}

/** Why a play cannot start right now, or null when it can. */
function refusalNow(id: string): ToyRemoteAck | null {
  if (snap.gate !== 'open') return { id, ok: false, reason: 'closed', detail: closedDetail(snap.closedBy) };
  if (snap.away) {
    return { id, ok: false, reason: 'away', detail: 'The owner\'s screen is off or the app is behind something, so nothing plays until they are back in it.' };
  }
  if (snap.hands) return { id, ok: false, reason: 'hands', detail: 'The owner has the orbs open and is driving the toys by hand.' };
  return null;
}

function looksLikeCommand(value: unknown): value is ToyRemoteCommand {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Partial<ToyRemoteCommand>;
  const light = c.action !== 'light' || (typeof c.light === 'object' && c.light !== null && ['on', 'off', 'flash'].includes(c.light.action));
  return typeof c.id === 'string' && typeof c.companion === 'string' && (c.action === 'play' || c.action === 'stop' || c.action === 'light') && light && typeof c.maxMs === 'number';
}

function onCommand(raw: unknown): void {
  if (!snap.bridge || !looksLikeCommand(raw)) return;
  const command = raw;
  // One at a time, in the order they came, so two never interleave.
  queue = queue.then(async () => {
    let ack: ToyRemoteAck;
    try {
      ack = await decide(command);
    } catch (error) {
      ack = { id: command.id, ok: false, reason: 'bad', detail: error instanceof Error ? error.message : String(error) };
    }
    try {
      await api.post('/api/toys/ack', ack);
    } catch {
      // The house gives up waiting on its own and tells the lane nothing answered.
    }
  });
}

// ---- the owner's side ----

/** The owner hands the remote over. */
export function handOver(): void {
  setSnap({ gate: 'open', closedBy: null, gateChangedAt: iso() }, true);
}

function closeGate(by: GateClosedBy, zero: boolean): void {
  endPlayback(zero);
  setSnap({ gate: 'closed', closedBy: by, gateChangedAt: iso() }, true);
}

/** The native stop, swappable in tests. */
let nativeStop: () => Promise<unknown> = stopAllToys;

/** The owner takes it back, and everything a lane had going stops with it
 *  (theirs, Oct 23 2026: 'if I take the remote from you, it should stop').
 *  What a lane drove goes to zero and every toy gets the native stop as
 *  well, so a pattern running on the toy itself ends too. The owner's own
 *  fingers on the orbs are theirs and keep going. */
export function takeBack(): void {
  const ownerHands = snap.hands;
  closeGate('owner', true);
  if (!ownerHands) void nativeStop().catch(() => {});
}

/** The owner's stop, from anywhere that is not the Toys page's own button: every toy
 *  and every motor through the native stop and its hold, and the remote back
 *  in the owner's hands. */
export function ownerStop(by: 'stop' | 'red' = 'stop'): void {
  closeGate(by, false);
  void nativeStop().catch(() => {});
}

/** The owner opened or closed the orbs. While they are open their fingers drive. */
export function setHands(on: boolean): void {
  if (on) endPlayback(true);
  setSnap({ hands: on }, true);
}

/** The owner moved one of the motors by hand, so that motor is theirs again. */
export function yieldToOwner(toyId: string, command: string): void {
  if (!playback || !playback.driven.delete(`${toyId}:${command}`)) return;
  if (playback.driven.size === 0) endPlayback(false);
  else setSnap({ playing: playingNow() }, true);
}

// ---- telling the house ----

function scheduleReport(): void {
  if (!snap.bridge) return;
  if (reportTimer) clearTimeout(reportTimer);
  reportTimer = setTimeout(() => {
    reportTimer = null;
    void report();
  }, 300);
}

/** The owner connected toys as the house is told about them. The battery is the
 *  toy's own last answer or nothing: never toy.battery, the SDK's field. */
async function phoneToys(): Promise<ToyPhoneToy[]> {
  try {
    const { toys: list } = await bridge.toys();
    return list
      .filter((toy) => toy.connected)
      .map((toy) => ({
        toyId: toy.toyId,
        name: toyName(toy),
        ...batteryFields(batteries.reading(toy.toyId)),
        motors: motorsFor(toy).map((m) => ({ command: m.command, label: m.label.toLowerCase(), max: m.max })),
        presets: presetsFor(toy),
        ...(lightsFor(toy).length ? { lights: lightsFor(toy) } : {}),
      }));
  } catch {
    return [];
  }
}

async function report(): Promise<void> {
  const toys = await phoneToys();
  const state: ToyPhoneState = {
    at: iso(),
    bridge: true,
    gate: snap.gate,
    ...(snap.gateChangedAt ? { gateChangedAt: snap.gateChangedAt } : {}),
    ...(snap.gate === 'closed' && snap.closedBy ? { closedBy: snap.closedBy } : {}),
    away: snap.away,
    hands: snap.hands,
    toys,
    playing: snap.playing,
  };
  try {
    await api.post('/api/toys/state', state);
  } catch {
    // The next change or the next minute tries again.
  }
}

/** Once, when the app starts. */
export function startToyRemote(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  const hasBridge = hasToyBridge();
  setSnap({ bridge: hasBridge, away: typeof document !== 'undefined' && document.hidden }, false);
  if (!hasBridge) return;
  // The owner taps on Connect are followed from here, the Toys page open or not.
  startToyConnectWatch();

  window.addEventListener('aerie:toy-command', (e) => onCommand((e as CustomEvent).detail));
  window.addEventListener('aerie:toys-red', () => ownerStop('red'));
  window.addEventListener('aerie:socket-connected', () => scheduleReport());
  document.addEventListener('visibilitychange', () => {
    const away = document.hidden;
    if (away) endPlayback(true);
    setSnap({ away }, true);
  });
  // Any stop, the Toys page's button included, takes the remote back.
  void LovenseToys.addListener('stopped', () => {
    if (snap.gate === 'open') closeGate('stop', false);
    else endPlayback(false);
  });
  void LovenseToys.addListener('connection', (c) => {
    scheduleReport();
    if (c.state === 'connected' || c.state === 'service_discovered') batteries.connected(c.toyId);
  });
  // The owner toys' own battery answers, asked for or volunteered. The house hears
  // a changed level at once, and an unchanged one at most once a minute.
  void LovenseToys.addListener('battery', (b) => {
    if (batteries.record(b)) scheduleReport();
  });
  setInterval(scheduleReport, 60_000);
  scheduleReport();
}

/** For tests only: the decisions with a stand-in bridge and no app around
 *  them, so a test can show what a command does to what is playing. */
export const toyRemoteTestSeam = {
  useBridge(next: Bridge): void {
    bridge = next;
  },
  /** Stand in for the native stop; returns the real one to put back. */
  useStopAll(next: () => Promise<unknown>): () => Promise<unknown> {
    const was = nativeStop;
    nativeStop = next;
    return was;
  },
  decide: (command: ToyRemoteCommand): Promise<ToyRemoteAck> => decide(command),
  /** A battery listener answer, as the app would hand it in. */
  recordBattery: (raw: unknown): boolean => batteries.record(raw),
  /** What the house would be told about the owner's toys right now. */
  phoneToys: (): Promise<ToyPhoneToy[]> => phoneToys(),
  /** As if this were the app with the toy bridge, so the remote's own asking runs. */
  pretendBridge(on: boolean): void {
    if (!on) batteries.want('remote', false);
    setSnap({ bridge: on }, false);
  },
};
