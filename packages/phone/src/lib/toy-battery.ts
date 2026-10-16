// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The owner toys' batteries, as the toys themselves answer, and when to ask.
//
// Why the number went stale (measured Oct 21 2026: the house said the Fizz
// was at 29 while the owner's Lovense app said about 59, and the Flexer at 0 while it
// ran fine): the house was sent the SDK's own battery field off the toy object
// the search found, and Lovense's README says that field only moves on an
// answer given while the toy is still ("When isWork is true ... the battery
// property of the Toy class will not be updated"). A toy running since it
// connected kept its unread starting value, and 0 went out as a level. And
// nothing asked at all unless the Toys page was open.
//
// So the level here is only ever the toy's own answer through the battery
// listener, kept with when it came and whether the toy was running, and a toy
// that has not answered has no level at all: absent, never 0. It is asked a
// beat after each connection, and every minute while something wants it (the
// remote handed over, or the Toys page open). A question moves nothing, so
// the owner's stop lets it through. Kept free of the app so it can be checked here.

import type { ToyPhoneToy } from '@aerie/shared';

export interface BatteryReading {
  level: number;
  /** The toy was running when it answered, which Lovense says can read off. */
  working: boolean;
  at: number;
}

/** One answer from the battery listener, or null when it is not a level. */
export function batteryAnswer(raw: unknown): { toyId: string; level: number; working: boolean } | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const b = raw as { toyId?: unknown; level?: unknown; working?: unknown };
  if (typeof b.toyId !== 'string' || !b.toyId) return null;
  if (typeof b.level !== 'number' || !Number.isFinite(b.level) || b.level < 0 || b.level > 100) return null;
  return { toyId: b.toyId, level: Math.round(b.level), working: b.working === true };
}

/** The house's battery fields for a toy: its own last answer, or none at all. */
export function batteryFields(reading: BatteryReading | undefined): Pick<ToyPhoneToy, 'battery' | 'batteryAt' | 'batteryWorking'> {
  if (!reading) return {};
  return {
    battery: reading.level,
    batteryAt: new Date(reading.at).toISOString(),
    ...(reading.working ? { batteryWorking: true } : {}),
  };
}

export interface BatteryWatchDeps {
  /** Ask one toy (GET_BATTERY). */
  ask: (toyId: string) => Promise<unknown>;
  /** The toys connected right now. */
  connectedToyIds: () => Promise<string[]>;
  now: () => number;
  every: (fn: () => void, ms: number) => unknown;
  cancelEvery: (handle: unknown) => void;
  later: (fn: () => void, ms: number) => unknown;
  /** How often to ask while something wants it. */
  everyMs?: number;
  /** How long after a connection, so the toy's services are there to answer. */
  settleMs?: number;
  /** An unchanged answer is passed on to the house at most this often. */
  refreshMs?: number;
}

export interface BatteryWatch {
  /** A battery listener answer. True when the house should be told. */
  record: (raw: unknown) => boolean;
  reading: (toyId: string) => BatteryReading | undefined;
  /** Every toy's reading, a new object whenever one changes. */
  view: () => Readonly<Record<string, BatteryReading>>;
  subscribe: (fn: () => void) => () => void;
  /** Something wants the levels kept fresh (remote, page), or no longer does. */
  want: (reason: string, on: boolean) => void;
  /** A toy just connected: ask it once it has settled. */
  connected: (toyId: string) => void;
}

export function createBatteryWatch(deps: BatteryWatchDeps): BatteryWatch {
  const everyMs = deps.everyMs ?? 60_000;
  const settleMs = deps.settleMs ?? 1_500;
  const refreshMs = deps.refreshMs ?? 50_000;
  const readings = new Map<string, BatteryReading>();
  const toldAt = new Map<string, number>();
  const subscribers = new Set<() => void>();
  const wants = new Set<string>();
  const settling = new Set<string>();
  let view: Readonly<Record<string, BatteryReading>> = {};
  let timer: unknown = null;

  const ask = (toyId: string) => {
    try {
      void deps.ask(toyId).catch(() => {});
    } catch {
      // A question that cannot go is asked again on the next round.
    }
  };
  const askAll = () => {
    void deps.connectedToyIds().then((ids) => ids.forEach(ask), () => {});
  };

  return {
    record(raw) {
      const answer = batteryAnswer(raw);
      if (!answer) return false;
      const now = deps.now();
      const before = readings.get(answer.toyId);
      const reading: BatteryReading = { level: answer.level, working: answer.working, at: now };
      readings.set(answer.toyId, reading);
      const changed = !before || before.level !== reading.level || before.working !== reading.working;
      if (changed) {
        view = Object.freeze(Object.fromEntries(readings));
        for (const fn of subscribers) fn();
      }
      const tell = changed || now - (toldAt.get(answer.toyId) ?? -Infinity) >= refreshMs;
      if (tell) toldAt.set(answer.toyId, now);
      return tell;
    },
    reading: (toyId) => readings.get(toyId),
    view: () => view,
    subscribe(fn) {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },
    want(reason, on) {
      const had = wants.size > 0;
      if (on) wants.add(reason);
      else wants.delete(reason);
      const has = wants.size > 0;
      if (has && !had) {
        askAll();
        timer = deps.every(askAll, everyMs);
      } else if (!has && had && timer !== null) {
        deps.cancelEvery(timer);
        timer = null;
      }
    },
    connected(toyId) {
      if (settling.has(toyId)) return;
      settling.add(toyId);
      deps.later(() => {
        settling.delete(toyId);
        ask(toyId);
      }, settleMs);
    },
  };
}
