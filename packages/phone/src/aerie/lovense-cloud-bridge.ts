// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The toy bridge for a screen with no Android app holding the toys: a
// laptop, a browser. It answers everything the Android bridge answers
// (aerie/lovense-toys.ts), so the whole Toys page works the same, the orbs,
// sliders, the pattern shelf, a toy's own patterns and sounds driving the
// toys, but every move goes to the house (POST /api/toys/cloud/play), which
// sends it to Lovense, which sends it to the Lovense Remote app on their phone.
// The developer token never comes near this page.
//
// The page moves a level dozens of times a second; Lovense's servers should
// hear about it a few times a second at most. So every level lands here and
// is gathered: one send per toy with every motor in it, no two sends closer
// than SEND_GAP_MS, the newest levels winning. A level that stays put is
// said again before its time runs out, and a toy taken to zero gets a stop.
// If Lovense says slow down, the bridge waits and tries again rather than
// piling on.
//
// Their stop is still the first thing and never waits behind a send: it clears
// everything gathered, goes straight to the house, and refuses every move
// for HOLD_MS after, the same promise the Android bridge makes.

import type { LovenseToy, ToyConnection, ToyError, ToysStatus } from './lovense-toys';

/** How the bridge reaches the house. Swappable in tests. */
export interface CloudTransport {
  get(url: string): Promise<unknown>;
  post(url: string, body: unknown): Promise<unknown>;
}

/** No two sends to Lovense closer than this. The house refuses faster anyway. */
export const SEND_GAP_MS = 300;
/** How long one send runs on the toy; said again before it runs out. */
export const SEND_SECONDS = 20;
export const RESEND_AFTER_MS = 14_000;
/** A toy's own pattern runs this long per send. */
export const PRESET_SECONDS = 60;
export const PRESET_RESEND_AFTER_MS = 54_000;
/** After their stop, every move is refused this long. */
export const HOLD_MS = 3000;
/** When Lovense says slow down. */
export const BACKOFF_MS = 2000;

/** The Android bridge's command names, as Lovense's server API words them. */
const ACTION_FOR: Record<string, string> = {
  VIBRATE: 'Vibrate',
  VIBRATE1: 'Vibrate1',
  VIBRATE2: 'Vibrate2',
  VIBRATE3: 'Vibrate3',
  FLEXER_VIBRATE: 'Vibrate',
  FLEXER_FINGER: 'Fingering',
  THRUST: 'Thrusting',
  ROTATE: 'Rotate',
  ROTATE_CLOCKWISE: 'Rotate',
  ROTATE_ANTI_CLOCKWISE: 'Rotate',
  OSCILLATE: 'Oscillate',
  AIR_AUTO: 'Pump',
};

/** The motor commands a toy answers to, from the name the Lovense app gives
 *  it, so the page draws the same sliders and orbs it would on the phone. */
export function commandsForToyName(name: string): string[] {
  const n = name.toLowerCase();
  if (n.includes('flexer')) return ['FLEXER_VIBRATE', 'FLEXER_FINGER', 'PRESET'];
  if (n.includes('edge') || n.includes('dolce')) return ['VIBRATE1', 'VIBRATE2', 'PRESET'];
  if (n.includes('nora')) return ['VIBRATE', 'ROTATE', 'PRESET'];
  if (n.includes('gravity')) return ['VIBRATE', 'THRUST', 'PRESET'];
  if (n === 'max' || n.startsWith('max ')) return ['VIBRATE', 'AIR_AUTO', 'PRESET'];
  return ['VIBRATE', 'PRESET'];
}

interface HouseToy { id: string; name: string; nickName: string; connected: boolean }
interface HouseStatus { hasToken?: boolean; toys?: HouseToy[] | null }

function toToy(t: HouseToy): LovenseToy {
  const shown = t.nickName || t.name || 'toy';
  return {
    toyId: t.id,
    name: shown.charAt(0).toUpperCase() + shown.slice(1),
    type: t.name,
    connected: t.connected,
    commands: commandsForToyName(t.name || ''),
  };
}

type Listener = (payload: never) => void;
type Handle = { remove: () => Promise<void> };

interface ToyWant {
  /** Lovense action word to level, for the motors. */
  levels: Map<string, number>;
  /** One of the toy's own patterns, 1 to 4, or 0. */
  preset: number;
  /** What was last sent for this toy, so an unchanged want is not sent again. */
  sent: string;
  sentAt: number;
}

export interface CloudBridge {
  status(): Promise<ToysStatus>;
  requestAccess(): Promise<ToysStatus>;
  setToken(options: { token: string }): Promise<ToysStatus>;
  search(): Promise<void>;
  stopSearch(): Promise<void>;
  connect(options: { toyId: string }): Promise<void>;
  disconnect(options: { toyId: string }): Promise<void>;
  toys(): Promise<{ toys: LovenseToy[] }>;
  command(options: { toyId: string; command: string; level?: number }): Promise<void>;
  stop(): Promise<{ stopped: number; holdMs: number }>;
  addListener(event: string, fn: (payload: never) => void): Promise<Handle>;
}

export function createCloudBridge(transport: CloudTransport, now: () => number = Date.now): CloudBridge & { pendingForTest(): string[] } {
  const listeners = new Map<string, Set<Listener>>();
  const wants = new Map<string, ToyWant>();
  let known = new Map<string, LovenseToy>();
  let tokenSet = false;
  let holdUntil = 0;
  let lastSendAt = 0;
  let pauseUntil = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let timerAt = 0;
  let sending = false;
  let lastOfflineSaid = 0;
  /** Round-robin, so two toys both moving both get their turn. */
  let turn = 0;

  function emit(event: string, payload: unknown): void {
    for (const fn of listeners.get(event) ?? []) {
      try { (fn as (p: unknown) => void)(payload); } catch { /* one listener does not stop the rest */ }
    }
  }

  async function readHouse(): Promise<LovenseToy[]> {
    let body: HouseStatus | null = null;
    try { body = (await transport.get('/api/toys/cloud')) as HouseStatus | null; } catch { body = null; }
    if (!body) return [...known.values()];
    tokenSet = !!body.hasToken;
    const next = new Map<string, LovenseToy>();
    for (const t of body.toys ?? []) if (t && t.id) next.set(t.id, toToy(t));
    // A toy coming or going in the Lovense app reads here as the phone's
    // bridge would say it, so everything that follows connections follows it.
    for (const [id, toy] of next) {
      const before = known.get(id);
      if (!before) emit('toyFound', toy);
      if (!before || before.connected !== toy.connected) emit('connection', { toyId: id, state: toy.connected ? 'connected' : 'disconnected' } satisfies ToyConnection);
    }
    for (const [id, before] of known) {
      if (!next.has(id) && before.connected) emit('connection', { toyId: id, state: 'disconnected' } satisfies ToyConnection);
    }
    known = next;
    return [...next.values()];
  }

  async function status(): Promise<ToysStatus> {
    const toys = await readHouse();
    return {
      bluetoothSupported: true,
      bluetoothOn: true,
      permitted: true,
      tokenSet,
      holdMs: Math.max(0, holdUntil - now()),
      toys,
    };
  }

  /** What a toy's want says to Lovense right now. */
  function shape(toyId: string, want: ToyWant): { body: Record<string, unknown>; key: string; live: boolean } {
    if (want.preset > 0) {
      return { body: { toy: toyId, preset: want.preset, timeSec: PRESET_SECONDS }, key: `p${want.preset}`, live: true };
    }
    // Every motor named, zeros too: the house sends these without stopping
    // what came before (no pause on every step), so a motor left out would keep its old level.
    if (![...want.levels.values()].some((level) => level > 0)) return { body: { toy: toyId, action: 'Stop' }, key: 'stop', live: false };
    const parts = [...want.levels].map(([action, level]) => `${action}:${level}`);
    return { body: { toy: toyId, action: parts.join(','), timeSec: SEND_SECONDS }, key: parts.join(','), live: true };
  }

  /** The next toy that has something new to say, or whose time is running out. */
  function nextDue(): { toyId: string; want: ToyWant; shaped: ReturnType<typeof shape> } | null {
    const ids = [...wants.keys()];
    for (let i = 0; i < ids.length; i += 1) {
      const toyId = ids[(turn + i) % ids.length];
      const want = wants.get(toyId)!;
      const shaped = shape(toyId, want);
      const resendAfter = want.preset > 0 ? PRESET_RESEND_AFTER_MS : RESEND_AFTER_MS;
      const changed = shaped.key !== want.sent;
      const stale = shaped.live && now() - want.sentAt >= resendAfter;
      if (changed || stale) {
        turn = (turn + i + 1) % Math.max(1, ids.length);
        return { toyId, want, shaped };
      }
    }
    return null;
  }

  function schedule(): void {
    if (sending) return;
    const due = nextDue();
    // Nothing new: wake for the next toy whose time runs out.
    let wait: number;
    if (due) wait = Math.max(0, lastSendAt + SEND_GAP_MS - now(), pauseUntil - now());
    else {
      let soonest = Infinity;
      for (const want of wants.values()) {
        const live = want.sent !== 'stop' && want.sent !== '';
        if (!live) continue;
        const after = want.preset > 0 ? PRESET_RESEND_AFTER_MS : RESEND_AFTER_MS;
        soonest = Math.min(soonest, want.sentAt + after - now());
      }
      if (!Number.isFinite(soonest)) return;
      wait = Math.max(SEND_GAP_MS, soonest);
    }
    // A timer already set for sooner stands; one set for later (a resend
    // long off) gives way to the move that just came in.
    const at = now() + wait;
    if (timer) {
      if (timerAt <= at) return;
      clearTimeout(timer);
    }
    timerAt = at;
    timer = setTimeout(() => { timer = null; void flush(); }, wait);
  }

  async function flush(): Promise<void> {
    if (sending || now() < holdUntil) { if (now() >= holdUntil) schedule(); return; }
    const due = nextDue();
    if (!due) { schedule(); return; }
    sending = true;
    lastSendAt = now();
    const { toyId, want, shaped } = due;
    let answer: { ok?: boolean; slow?: boolean; offline?: boolean; error?: string } | null = null;
    try { answer = (await transport.post('/api/toys/cloud/play', shaped.body)) as typeof answer; } catch { answer = null; }
    sending = false;
    // Their stop landed while this was on its way: what it set no longer counts.
    if (now() < holdUntil || wants.get(toyId) !== want) { schedule(); return; }
    if (answer?.ok) {
      want.sent = shaped.key;
      want.sentAt = now();
      if (!shaped.live && want.preset === 0) wants.delete(toyId);
    } else if (answer?.offline) {
      // Nothing reaches their toys until the Lovense app is back, so the want is
      // dropped rather than hammered, and they are told once in a while.
      wants.delete(toyId);
      if (now() - lastOfflineSaid > 30_000) {
        lastOfflineSaid = now();
        emit('toyError', { toyId, message: 'The Lovense app on your phone is not linked or not open, so nothing reaches the toys.' } satisfies ToyError);
      }
    } else {
      pauseUntil = now() + BACKOFF_MS;
      if (answer?.error && !answer.slow) emit('toyError', { toyId, message: answer.error } satisfies ToyError);
    }
    schedule();
  }

  function held(): Error {
    return Object.assign(new Error('The stop is holding the toys still for a moment.'), { code: 'HELD' });
  }

  const bridge: CloudBridge & { pendingForTest(): string[] } = {
    status,
    requestAccess: status,
    // The token stays with the house. Nothing here ever holds it.
    setToken: () => status(),
    async search() {
      const toys = await readHouse();
      for (const toy of toys) emit('toyFound', toy);
      emit('searchFinished', {});
    },
    async stopSearch() {},
    async connect({ toyId }) {
      const toys = await readHouse();
      const toy = toys.find((t) => t.toyId === toyId);
      if (toy?.connected) emit('connection', { toyId, state: 'connected' } satisfies ToyConnection);
      else emit('toyError', { toyId, message: 'Connect it in the Lovense Remote app on your phone, and it shows here.' } satisfies ToyError);
    },
    async disconnect({ toyId }) {
      emit('toyError', { toyId, message: 'Disconnect it in the Lovense Remote app on your phone.' } satisfies ToyError);
    },
    async toys() {
      return { toys: await readHouse() };
    },
    async command({ toyId, command, level }) {
      if (now() < holdUntil) throw held();
      // A zero for a toy with nothing going is already true; nothing to send.
      if (!wants.has(toyId) && !(Number(level) > 0)) return;
      const want = wants.get(toyId) ?? { levels: new Map<string, number>(), preset: 0, sent: '', sentAt: 0 };
      const value = Math.max(0, Math.round(level ?? 0));
      if (command === 'PRESET') {
        want.preset = Math.min(4, value);
        if (want.preset > 0) want.levels.clear();
      } else {
        const action = ACTION_FOR[command];
        // Lights and anything else the server road cannot carry move nothing.
        if (!action) return;
        want.levels.set(action, Math.min(action === 'Pump' ? 3 : 20, value));
        if (value > 0) want.preset = 0;
      }
      wants.set(toyId, want);
      schedule();
    },
    async stop() {
      holdUntil = now() + HOLD_MS;
      const stopped = wants.size;
      wants.clear();
      if (timer) { clearTimeout(timer); timer = null; }
      emit('stopped', { stopped, holdMs: HOLD_MS });
      try { await transport.post('/api/toys/cloud/stop', {}); } catch { /* the toys' own app and Take it back still work */ }
      return { stopped, holdMs: HOLD_MS };
    },
    async addListener(event, fn) {
      const set = listeners.get(event) ?? new Set<Listener>();
      set.add(fn as Listener);
      listeners.set(event, set);
      return { remove: async () => { set.delete(fn as Listener); } };
    },
    pendingForTest() {
      return [...wants].map(([id, w]) => `${id}=${shape(id, w).key}`);
    },
  };
  return bridge;
}
