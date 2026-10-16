// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// One tap of Connect on the Toys page, followed to its end, and written down.
//
// Theirs, Oct 19 and Oct 21 2026: "Sometimes I have to go out of the toy app and
// back in or tap it a couple times to get it to connect to one" (three tries
// for the Fizz after charging, the morning of the 21st). The page had two
// faults the code shows, whatever the toy was doing:
//   - every connection callback ended the attempt, the SDK's "connecting"
//     included (its README lists it first; Lovense's own sample does nothing
//     on it), so the spinner stopped and Connect came back mid-connection;
//   - nothing ended an attempt that got no final callback, or whose error came
//     through the SDK's onError instead (the plugin hands it on as toyError
//     with the toy's id, and the page only showed the message), so the button
//     stayed greyed with its spinner until the owner left the page.
// Here an attempt ends only on connected or service_discovered, on failed, on
// an error for that toy, or when it gives up waiting and reads the toy list
// once. The button comes back after a few seconds so the owner can tap again, as
// Lovense's sample offers. And every attempt is written down step by step,
// so the next tap that misses says what happened instead of being guessed at.
// Kept free of the app: the bridge, the clock and the log are handed in.

export type ConnectOutcome =
  | 'connected'
  | 'failed'
  | 'error'
  /** The app would not even ask the SDK: the bridge rejected the call. */
  | 'refused'
  | 'timeout'
  /** No callback came, but the toy list said connected when it gave up waiting. */
  | 'connected-quietly'
  /** The owner tapped Connect again before this one ended. */
  | 'tapped-again';

export interface ConnectContext {
  name: string;
  /** A search was running when the owner tapped. */
  scanning: boolean;
  bluetoothOn?: boolean;
  tokenSet?: boolean;
  /** What the page showed for the toy when the owner tapped. */
  shownConnected?: boolean;
}

/** [ms from the tap (or from the end, on a late record), what, detail]. */
export type ConnectStep = [number, string] | [number, string, string];

export interface ConnectRecord {
  kind: 'attempt' | 'late';
  toyId: string;
  name: string;
  /** Taps in a row on this toy with no connection between them: 1, 2, 3. */
  try: number;
  outcome: ConnectOutcome;
  /** Tap to outcome. */
  ms?: number;
  ctx?: Omit<ConnectContext, 'name'>;
  /** When a search last saw the toy before the tap, and how strong; null when none has this session. */
  found?: { agoMs: number; rssi?: number } | null;
  steps: ConnectStep[];
  /** Steps that did not fit. */
  dropped?: number;
  /** The toy list read when the record closed. */
  after?: { connected: boolean; commands: number } | null;
}

export interface ConnectView {
  /** An attempt is waiting on the toy. */
  connecting: boolean;
  /** Connect may be pressed again. */
  canTapAgain: boolean;
  tries: number;
}

export interface ConnectEnd {
  toyId: string;
  outcome: ConnectOutcome;
  tries: number;
  detail?: string;
}

export interface ConnectTrackerDeps {
  now: () => number;
  later: (fn: () => void, ms: number) => unknown;
  cancel: (handle: unknown) => void;
  /** The bridge's connect, which settles once the SDK has been asked. */
  connect: (toyId: string) => Promise<unknown>;
  /** One read of the toy list for this toy; null when it is not listed. */
  readToy: (toyId: string) => Promise<{ connected: boolean; commands: number } | null>;
  report: (record: ConnectRecord) => void;
  /** Connect comes back this long after a tap. */
  retryAfterMs?: number;
  /** An attempt with no final callback gives up waiting here. */
  giveUpMs?: number;
  /** Steps after an end are still written down for this long. */
  tailMs?: number;
  /** A tap this soon after a miss on the same toy is its next try. */
  streakMs?: number;
  /** A callback this soon after a record closed is sent on its own. */
  lateMs?: number;
  maxSteps?: number;
}

export const CONNECT_TIMING = { retryAfterMs: 5_000, giveUpMs: 25_000, tailMs: 10_000, streakMs: 5 * 60_000, lateMs: 2 * 60_000, maxSteps: 40 } as const;

interface Attempt {
  toyId: string;
  name: string;
  n: number;
  t0: number;
  ctx: Omit<ConnectContext, 'name'>;
  found: { agoMs: number; rssi?: number } | null;
  steps: ConnectStep[];
  dropped: number;
  phase: 'waiting' | 'tail';
  outcome?: ConnectOutcome;
  ms?: number;
  after?: { connected: boolean; commands: number } | null;
  lastFound?: boolean;
  timers: unknown[];
  sent: boolean;
}

const CONNECTED: readonly ConnectOutcome[] = ['connected', 'connected-quietly'];

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return typeof error === 'string' ? error : String(error);
}

export function createConnectTracker(deps: ConnectTrackerDeps) {
  const t = {
    retryAfterMs: deps.retryAfterMs ?? CONNECT_TIMING.retryAfterMs,
    giveUpMs: deps.giveUpMs ?? CONNECT_TIMING.giveUpMs,
    tailMs: deps.tailMs ?? CONNECT_TIMING.tailMs,
    streakMs: deps.streakMs ?? CONNECT_TIMING.streakMs,
    lateMs: deps.lateMs ?? CONNECT_TIMING.lateMs,
    maxSteps: deps.maxSteps ?? CONNECT_TIMING.maxSteps,
  };
  const attempts = new Map<string, Attempt>();
  const lastEnded = new Map<string, { endedAt: number; outcome: ConnectOutcome; n: number; name: string }>();
  const found = new Map<string, { at: number; rssi?: number }>();
  const subscribers = new Set<() => void>();
  const endListeners = new Set<(end: ConnectEnd) => void>();
  let snapshot: Readonly<Record<string, ConnectView>> = {};

  const later = (a: Attempt, fn: () => void, ms: number) => {
    a.timers.push(deps.later(fn, ms));
  };
  const clearTimers = (a: Attempt) => {
    for (const h of a.timers.splice(0)) deps.cancel(h);
  };

  function refresh(): void {
    const now = deps.now();
    const next: Record<string, ConnectView> = {};
    for (const a of attempts.values()) {
      if (a.phase !== 'waiting') continue;
      next[a.toyId] = { connecting: true, canTapAgain: now - a.t0 >= t.retryAfterMs, tries: a.n };
    }
    snapshot = Object.freeze(next);
    for (const fn of subscribers) fn();
  }

  function step(a: Attempt, what: string, detail?: string): void {
    if (a.steps.length >= t.maxSteps) {
      a.dropped++;
      return;
    }
    const ms = deps.now() - a.t0;
    a.steps.push(detail ? [ms, what, detail.slice(0, 120)] : [ms, what]);
  }

  function send(a: Attempt): void {
    if (a.sent) return;
    a.sent = true;
    clearTimers(a);
    if (attempts.get(a.toyId) === a) attempts.delete(a.toyId);
    deps.report({
      kind: 'attempt',
      toyId: a.toyId,
      name: a.name,
      try: a.n,
      outcome: a.outcome ?? 'timeout',
      ...(a.ms !== undefined ? { ms: a.ms } : {}),
      ctx: a.ctx,
      found: a.found,
      steps: a.steps,
      ...(a.dropped ? { dropped: a.dropped } : {}),
      ...(a.after !== undefined ? { after: a.after } : {}),
    });
  }

  function closeTail(a: Attempt): void {
    if (a.sent) return;
    void deps.readToy(a.toyId).then((r) => r, () => null).then((r) => {
      a.after = r;
      send(a);
    });
  }

  function finish(a: Attempt, outcome: ConnectOutcome, detail?: string, tail = true): void {
    if (a.phase !== 'waiting') return;
    a.phase = 'tail';
    a.outcome = outcome;
    a.ms = deps.now() - a.t0;
    clearTimers(a);
    lastEnded.set(a.toyId, { endedAt: deps.now(), outcome, n: a.n, name: a.name });
    refresh();
    for (const fn of endListeners) fn({ toyId: a.toyId, outcome, tries: a.n, ...(detail ? { detail } : {}) });
    if (tail) later(a, () => closeTail(a), t.tailMs);
    else send(a);
  }

  function late(toyId: string, what: string, detail?: string): void {
    const last = lastEnded.get(toyId);
    if (!last) return;
    const ago = deps.now() - last.endedAt;
    if (ago > t.lateMs) return;
    deps.report({
      kind: 'late',
      toyId,
      name: last.name,
      try: last.n,
      outcome: last.outcome,
      steps: [detail ? [ago, what, detail.slice(0, 120)] : [ago, what]],
    });
  }

  function giveUp(a: Attempt): void {
    if (a.phase !== 'waiting') return;
    step(a, 'no answer');
    void deps.readToy(a.toyId).then((r) => r, () => null).then((r) => {
      if (a.phase !== 'waiting') return;
      step(a, 'read', r ? `connected=${r.connected} commands=${r.commands}` : 'not listed');
      finish(a, r?.connected ? 'connected-quietly' : 'timeout');
    });
  }

  return {
    /** The owner tapped Connect. */
    start(toyId: string, ctx: ConnectContext): void {
      const now = deps.now();
      const prev = attempts.get(toyId);
      let n = 1;
      if (prev?.phase === 'waiting') {
        step(prev, 'tapped again');
        finish(prev, 'tapped-again', undefined, false);
        n = prev.n + 1;
      } else {
        if (prev) send(prev);
        const last = lastEnded.get(toyId);
        if (last && !CONNECTED.includes(last.outcome) && now - last.endedAt < t.streakMs) n = last.n + 1;
      }
      const seen = found.get(toyId);
      const { name, ...rest } = ctx;
      const a: Attempt = {
        toyId,
        name: name.slice(0, 40),
        n,
        t0: now,
        ctx: rest,
        found: seen ? { agoMs: now - seen.at, ...(seen.rssi !== undefined ? { rssi: seen.rssi } : {}) } : null,
        steps: [],
        dropped: 0,
        phase: 'waiting',
        timers: [],
        sent: false,
      };
      attempts.set(toyId, a);
      step(a, 'tap');
      later(a, refresh, t.retryAfterMs);
      later(a, () => giveUp(a), t.giveUpMs);
      refresh();
      let asked: Promise<unknown>;
      try {
        asked = deps.connect(toyId);
      } catch (error) {
        asked = Promise.reject(error);
      }
      void asked.then(
        () => step(a, 'asked'),
        (error) => {
          const why = errorText(error);
          step(a, 'refused', why);
          finish(a, 'refused', why);
        },
      );
    },
    /** A connection callback, as the SDK said it. */
    connection(toyId: string, state: string): void {
      const a = attempts.get(toyId);
      if (!a) {
        late(toyId, 'cb', state);
        return;
      }
      step(a, 'cb', state);
      if (state === 'connected' || state === 'service_discovered') finish(a, 'connected');
      else if (state === 'failed') finish(a, 'failed');
    },
    /** A toyError: with a toy id it is that toy's, without one it is the search's. */
    error(e: { toyId?: string; code?: number; message?: string }): void {
      const detail = `${e.code ?? ''} ${e.message ?? ''}`.trim();
      if (e.toyId) {
        const a = attempts.get(e.toyId);
        if (!a) {
          late(e.toyId, 'error', detail);
          return;
        }
        step(a, 'error', detail);
        finish(a, 'error', detail);
        return;
      }
      for (const a of attempts.values()) step(a, 'error, no toy', detail);
    },
    /** A search turned the toy up. Written down only when what it says changes. */
    found(toyId: string, connected: boolean, rssi?: number): void {
      found.set(toyId, { at: deps.now(), ...(rssi !== undefined ? { rssi } : {}) });
      const a = attempts.get(toyId);
      if (!a || a.lastFound === connected) return;
      a.lastFound = connected;
      step(a, 'found', connected ? 'connected' : 'not connected');
    },
    search(state: 'started' | 'finished'): void {
      for (const a of attempts.values()) step(a, `search ${state}`);
    },
    /** The Toys page opened or closed while attempts were going. */
    page(open: boolean): void {
      for (const a of attempts.values()) step(a, open ? 'page back' : 'page left');
    },
    view: (): Readonly<Record<string, ConnectView>> => snapshot,
    subscribe(fn: () => void): () => void {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },
    onEnded(fn: (end: ConnectEnd) => void): () => void {
      endListeners.add(fn);
      return () => {
        endListeners.delete(fn);
      };
    },
  };
}

export type ConnectTracker = ReturnType<typeof createConnectTracker>;
