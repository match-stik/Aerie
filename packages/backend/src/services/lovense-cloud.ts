// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The cloud road to the toys, for when there is no Android phone holding
// them (a laptop, a browser).
//
// Lovense's Standard API by server: the Lovense Remote app on the person's own
// phone holds the toys, the house links to it once with a QR code (or the link
// to the QR picture, which is what Lovense actually hands back), and every
// command after that goes to Lovense's servers with the house's developer
// token and this house's id. Nothing calls back and nothing needs a public
// address. The token never leaves the server (Lovense's written consent,
// condition 2).
//
// TWO WORRIES SHAPE IT. A bridge left open after somebody forgot to
// disconnect it runs into Lovense's rate limits. So: nothing here polls
// Lovense; the road to the toys (the gate) is closed until they open it, and
// closes by itself after a quiet spell; and Disconnect rotates this house's id,
// so the old link is dead on Lovense's side too, not only on ours.
//
// Condition 6 (AI control): their stop works without the companions (the
// Toys page's Stop, Take it back, and the Lovense Remote app itself), levels stay 0 to 20, and
// every command carries a time (Lovense treats timeSec 0 as forever, so a
// play is never sent with 0).

import { randomUUID } from 'node:crypto';
import type { ToyRemoteAck, ToyRemoteCommand, ToyStep } from '@aerie/shared';
import { getSecret } from './secrets.js';
import { getConfig, setConfig } from './db/config.js';

const API = 'https://api.lovense-api.com/api/lan';
/** The gate closes by itself after this long with no command through it. */
export const CLOUD_IDLE_CLOSE_MS = 2 * 60 * 60 * 1000;

const PRESETS = ['pulse', 'wave', 'fireworks', 'earthquake'] as const;

/** Lovense's action word for one of the house's motor names. */
export function cloudAction(motor: string): string {
  const m = motor.toLowerCase();
  if (/^vibrate[123]$/.test(m)) return 'Vibrate' + m.slice(-1);
  if (m === 'all') return 'All';
  if (m.includes('finger')) return 'Fingering';
  if (m.includes('suction') || m.includes('suck')) return 'Suction';
  if (m.includes('rotat')) return 'Rotate';
  if (m.includes('pump') || m.includes('air')) return 'Pump';
  if (m.includes('thrust')) return 'Thrusting';
  if (m.includes('depth')) return 'Depth';
  if (m.includes('oscill')) return 'Oscillate';
  if (m.includes('stroke')) return 'Stroke';
  return 'Vibrate';
}

export type CloudPayload = Record<string, string | number>;

/**
 * A command the house already checked (commandFromLane), as Lovense's server
 * API wants it. Never a play with timeSec 0, which Lovense runs forever.
 */
export function commandToCloud(command: ToyRemoteCommand): { ok: true; payload: CloudPayload; later?: { atMs: number; payload: CloudPayload }[] } | { ok: false; detail: string } {
  if (command.action === 'stop') return { ok: true, payload: { command: 'Function', action: 'Stop', timeSec: 0 } };
  if (command.action === 'light') {
    return { ok: false, detail: 'Lights only reach their toys through the Android app; the Lovense app road carries motion only.' };
  }
  const timeSec = Math.max(1, Math.round(command.maxMs / 1000));
  if (command.preset) {
    const name = PRESETS[command.preset - 1];
    if (!name) return { ok: false, detail: 'preset is 1 to 4.' };
    return { ok: true, payload: { command: 'Preset', name, timeSec } };
  }
  const tracks = Object.entries(command.tracks ?? {});
  if (tracks.length === 0) return { ok: false, detail: 'Nothing to play.' };
  // Every track a single held level: one Function with every motor in it.
  if (tracks.every(([, steps]) => steps.length === 1)) {
    const action = tracks.map(([motor, steps]) => `${cloudAction(motor)}:${steps[0][0]}`).join(',');
    return { ok: true, payload: { command: 'Function', action, timeSec } };
  }
  // A pattern. Lovense's own Pattern command answered yes and moved nothing
  // on a Fizz (a slow 0-to-4 ramp, while a plain held 4 straight after did),
  // and it only ever carried one motor. So the house steps through the
  // pattern itself: one Function at each change, every motor named, zeros
  // too, sent without stopping the one before (stopPrevious 0, so a step up
  // is not a pause), and a stop at the end.
  const timeline = timelineFor(tracks, command.maxMs);
  if (timeline.length === 0) return { ok: false, detail: 'Nothing to play.' };
  const sends = timeline.map((point, n) => {
    const nextAt = n + 1 < timeline.length ? timeline[n + 1].atMs : command.maxMs;
    return {
      atMs: point.atMs,
      payload: { command: 'Function', action: point.action, timeSec: Math.max(2, Math.ceil((nextAt - point.atMs) / 1000) + 1), stopPrevious: 0 } as CloudPayload,
    };
  });
  return {
    ok: true,
    payload: sends[0].payload,
    later: [...sends.slice(1), { atMs: command.maxMs, payload: { command: 'Function', action: 'Stop', timeSec: 0 } }],
  };
}

/** No two of a pattern's sends closer than this, so a quick pattern cannot flood Lovense. */
export const STEP_MIN_GAP_MS = 300;
/** And no pattern sends more than this many times in all. */
const STEP_MAX_SENDS = 600;

/** Each track's level at a moment, looping each track over its own length. */
function levelAt(steps: ToyStep[], length: number, t: number): number {
  let tt = length > 0 ? t % length : 0;
  for (const [level, ms] of steps) {
    if (tt < ms) return level;
    tt -= ms;
  }
  return steps[steps.length - 1][0];
}

/** Every moment a pattern changes, with every motor's level then, no two closer than STEP_MIN_GAP_MS. */
export function timelineFor(tracks: [string, ToyStep[]][], totalMs: number): { atMs: number; action: string }[] {
  const lengths = tracks.map(([, steps]) => steps.reduce((sum, [, ms]) => sum + ms, 0));
  const moments = new Set<number>([0]);
  tracks.forEach(([, steps], k) => {
    const length = lengths[k];
    if (length <= 0) return;
    for (let start = 0; start < totalMs && moments.size < STEP_MAX_SENDS * 4; start += length) {
      let at = start;
      for (const [, ms] of steps) {
        if (at >= totalMs) break;
        moments.add(at);
        at += ms;
      }
    }
  });
  const out: { atMs: number; action: string }[] = [];
  for (const at of [...moments].sort((a, b) => a - b)) {
    if (out.length && at - out[out.length - 1].atMs < STEP_MIN_GAP_MS) continue;
    const action = tracks.map(([motor, steps], k) => `${cloudAction(motor)}:${levelAt(steps, lengths[k], at)}`).join(',');
    if (out.length && out[out.length - 1].action === action) continue;
    out.push({ atMs: at, action });
    if (out.length >= STEP_MAX_SENDS) break;
  }
  return out;
}

// ---- state ----

let open = false;
let lastUsedAt = 0;
let closeTimer: ReturnType<typeof setTimeout> | null = null;

interface CloudStore {
  token(): string | null;
  readUid(): string | null;
  writeUid(id: string): void;
  readToys?(): string | null;
  writeToys?(json: string): void;
}
const liveStore: CloudStore = {
  token: () => getSecret('lovense_developer_token') || null,
  readUid: () => getConfig('toys.cloud_uid'),
  writeUid: (id) => setConfig('toys.cloud_uid', id),
  readToys: () => getConfig('toys.cloud_toys'),
  writeToys: (json) => setConfig('toys.cloud_toys', json),
};
let store: CloudStore = liveStore;
/** For tests only: stand in for the secrets store and the config rows. */
export function useCloudStoreForTest(next: CloudStore | null): void {
  store = next ?? liveStore;
}

function newUid(): string {
  return `aerie-${randomUUID().slice(0, 12)}`;
}

function uid(): string {
  let id = store.readUid();
  if (!id) {
    id = newUid();
    store.writeUid(id);
  }
  return id;
}

function token(): string | null {
  return store.token();
}

function armIdleClose(): void {
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = setTimeout(() => {
    if (open && Date.now() - lastUsedAt >= CLOUD_IDLE_CLOSE_MS) {
      open = false;
      console.log('[Toys] the Lovense app road closed itself after a quiet spell');
    }
  }, CLOUD_IDLE_CLOSE_MS + 1000);
  closeTimer.unref?.();
}

export type Fetcher = (url: string, body: Record<string, unknown>) => Promise<{ result?: boolean; code?: number; message?: string; data?: unknown }>;

const liveFetch: Fetcher = async (url, body) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  return res.json() as Promise<{ result?: boolean; code?: number; message?: string; data?: unknown }>;
};

let post: Fetcher = liveFetch;
/** For tests only. */
export function useCloudFetchForTest(f: Fetcher | null): void {
  post = f ?? liveFetch;
}
/** For tests only. */
export function resetCloudForTests(): void {
  cancelSteps();
  open = false;
  lastLink = null;
  reported = null;
  lastUsedAt = 0;
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = null;
}

// What the Lovense Remote app last said it holds. Lovense's server road has
// no call that lists toys (its GetToys is the local API's); the list only
// comes when the app posts to the callback URL set in the developer dashboard
// (after the scan, and again as it changes). Kept in memory: it is a reading,
// not a record.
export interface CloudToy { id: string; name: string; nickName: string; connected: boolean }
let reported: { toys: CloudToy[]; at: number } | null = null;

/** The Lovense app's callback. True when it was ours (our id) and was kept. */
export function recordCloudCallback(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  if (typeof b.uid !== 'string' || b.uid !== store.readUid()) return false;
  let raw: unknown = b.toys;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { raw = null; }
  }
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.values(raw as Record<string, unknown>) : [];
  const toys: CloudToy[] = [];
  for (const t of list.slice(0, 20)) {
    if (!t || typeof t !== 'object') continue;
    const r = t as Record<string, unknown>;
    const text = (v: unknown) => (typeof v === 'string' ? v.slice(0, 60) : typeof v === 'number' ? String(v) : '');
    toys.push({ id: text(r.id), name: text(r.name), nickName: text(r.nickName), connected: r.status === 1 || r.status === '1' || r.status === true });
  }
  reported = { toys, at: Date.now() };
  // Kept across them restarts too, so the laptop's page has toys to draw
  // before the Lovense app next posts (it posts when something changes).
  try { store.writeToys?.(JSON.stringify(reported)); } catch { /* a reading; the next post brings it */ }
  return true;
}

function loadReported(): void {
  if (reported) return;
  try {
    const raw = store.readToys?.();
    if (!raw) return;
    const parsed = JSON.parse(raw) as { toys?: CloudToy[]; at?: number };
    if (Array.isArray(parsed.toys) && typeof parsed.at === 'number') reported = { toys: parsed.toys.slice(0, 20), at: parsed.at };
  } catch {
    // Nothing kept, or nothing readable: the next post from the app brings it.
  }
}

export function cloudIsOpen(): boolean {
  return open;
}

export function cloudStatus() {
  loadReported();
  return {
    hasToken: !!token(),
    open,
    lastUsedAt: lastUsedAt ? new Date(lastUsedAt).toISOString() : null,
    closesAfterQuietMinutes: CLOUD_IDLE_CLOSE_MS / 60_000,
    toys: reported?.toys ?? null,
    toysAt: reported ? new Date(reported.at).toISOString() : null,
  };
}

/** The QR picture (and its code) the person scans in the Lovense Remote app. */
// Linking again and again is what runs into Lovense's limits (the commands
// themselves do not), so a second press inside a minute hands back the link it already has instead of asking.
export const LINK_COOLDOWN_MS = 60_000;
let lastLink: { qr: string; code: string | null; uid: string; at: number } | null = null;

export async function cloudLink(): Promise<{ ok: true; qr: string; code: string | null } | { ok: false; error: string }> {
  const t = token();
  if (!t) return { ok: false, error: 'No Lovense developer token yet: add it in Settings, Secrets.' };
  const id = uid();
  if (lastLink && lastLink.uid === id && Date.now() - lastLink.at < LINK_COOLDOWN_MS) {
    return { ok: true, qr: lastLink.qr, code: lastLink.code };
  }
  try {
    const out = await post(`${API}/getQrCode`, { token: t, uid: id, uname: 'Aerie', v: 2 });
    const data = (out.data ?? {}) as { qr?: string; code?: string };
    if (!out.result || !data.qr) return { ok: false, error: out.message || 'Lovense did not hand back a link.' };
    lastLink = { qr: data.qr, code: data.code ?? null, uid: id, at: Date.now() };
    return { ok: true, qr: data.qr, code: data.code ?? null };
  } catch (err) {
    return { ok: false, error: `Could not reach Lovense: ${(err as Error).message}` };
  }
}

/** One look at whether the Lovense app is linked and what toys it holds. On demand only. */
export async function cloudToys(): Promise<{ ok: true; toys: unknown } | { ok: false; error: string; offline?: boolean }> {
  const t = token();
  if (!t) return { ok: false, error: 'No Lovense developer token yet.' };
  try {
    const out = await post(`${API}/v2/command`, { token: t, uid: uid(), apiVer: 1, command: 'GetToys' });
    if (out.code === 507) return { ok: false, offline: true, error: 'The Lovense app is not linked or not open on the phone.' };
    if (!out.result) return { ok: false, error: out.message || 'Lovense said no.' };
    return { ok: true, toys: out.data ?? null };
  } catch (err) {
    return { ok: false, error: `Could not reach Lovense: ${(err as Error).message}` };
  }
}

/** Hand the remote over on this road, or take it back (which also stops). */
export async function setCloudOpen(next: boolean): Promise<void> {
  if (!next) cancelSteps();
  if (!next && open) await cloudStopNow();
  open = next;
  if (next) {
    lastUsedAt = Date.now();
    armIdleClose();
  }
}

/** Stop whatever is playing on this road. Safe to press any time. */
export async function cloudStopNow(): Promise<{ ok: boolean; error?: string }> {
  cancelSteps();
  const t = token();
  if (!t) return { ok: false, error: 'No Lovense developer token.' };
  try {
    const out = await post(`${API}/v2/command`, { token: t, uid: uid(), apiVer: 1, command: 'Function', action: 'Stop', timeSec: 0 });
    return { ok: !!out.result, error: out.result ? undefined : out.message };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Close the road and make the old link worthless: a new id, so Lovense forgets the pairing. */
export async function cloudDisconnect(): Promise<void> {
  if (open) await cloudStopNow();
  open = false;
  store.writeUid(newUid());
  // The old link is dead, so what it said it held is no longer ours to show.
  reported = { toys: [], at: Date.now() };
  try { store.writeToys?.(JSON.stringify(reported)); } catch { /* nothing else to undo */ }
}

// The rest of a stepped pattern, waiting on its moments. One at a time; a
// new play, any stop, closing the road and Disconnect all cancel it.
let stepTimers: ReturnType<typeof setTimeout>[] = [];
function cancelSteps(): void {
  for (const timer of stepTimers) clearTimeout(timer);
  stepTimers = [];
}
function scheduleSteps(t: string, later: { atMs: number; payload: CloudPayload }[]): void {
  const mine: ReturnType<typeof setTimeout>[] = [];
  for (const step of later) {
    const timer = setTimeout(() => {
      if (stepTimers !== mine) return;
      if (!open && step.payload.action !== 'Stop') { cancelSteps(); return; }
      post(`${API}/v2/command`, { token: t, uid: uid(), apiVer: 1, ...step.payload })
        .then((out) => { if (out.result) lastUsedAt = Date.now(); else if (out.code === 507) cancelSteps(); })
        .catch(() => { /* the next step tries again; their stop never waits on this */ });
    }, step.atMs);
    timer.unref?.();
    mine.push(timer);
  }
  stepTimers = mine;
}

/** A lane's command down the cloud road. Never throws; the answer reads like the phone's. */
export async function relayToCloud(command: ToyRemoteCommand): Promise<ToyRemoteAck> {
  const base = { id: command.id };
  if (!open && command.action !== 'stop') {
    return { ...base, ok: false, reason: 'closed', detail: 'They have not handed over the remote on the Lovense app road, or took it back.' };
  }
  const t = token();
  if (!t) return { ...base, ok: false, reason: 'no-bridge', detail: 'This house has no Lovense developer token.' };
  const shaped = commandToCloud(command);
  if (!shaped.ok) return { ...base, ok: false, reason: 'bad', detail: shaped.detail };
  // Whatever a lane had stepping ends here: a new play replaces it, a stop stops it.
  cancelSteps();
  try {
    const out = await post(`${API}/v2/command`, { token: t, uid: uid(), apiVer: 1, ...shaped.payload });
    if (out.code === 507) {
      return { ...base, ok: false, reason: 'no-bridge', detail: 'The Lovense app on their phone is not linked or not open, so nothing reaches their toys.' };
    }
    if (!out.result) return { ...base, ok: false, reason: 'bad', detail: `Lovense said: ${out.message || 'no'}` };
    lastUsedAt = Date.now();
    armIdleClose();
    if (command.action === 'stop') return { ...base, ok: true, playing: null };
    if (shaped.later?.length) scheduleSteps(t, shaped.later);
    const startedAt = new Date();
    return {
      ...base,
      ok: true,
      playing: {
        companion: command.companion,
        commandId: command.id,
        startedAt: startedAt.toISOString(),
        endsAt: new Date(startedAt.getTime() + Math.max(1000, command.maxMs)).toISOString(),
        motors: [],
        ...(command.preset ? { preset: command.preset } : {}),
      },
    };
  } catch (err) {
    return { ...base, ok: false, reason: 'no-answer', detail: `Could not reach Lovense: ${(err as Error).message}` };
  }
}

// ---- their own hands on the Lovense app road ----
//
// The Toys page on a screen with no Android bridge (a laptop) plays through
// here: the orbs, the sliders, the pattern shelf, a toy's own patterns and
// sounds driving the toys. It is their own hand, so it does not wait on the
// gate they hand to the companions. The page already gathers a burst of moves
// into one send a few times a second; this side refuses anything faster than that as well, so a
// stuck page can never run up Lovense's limits.

/** Lovense action words the page may send, each with its top level. */
const HAND_ACTIONS: Record<string, number> = {
  Vibrate: 20, Vibrate1: 20, Vibrate2: 20, Vibrate3: 20,
  Fingering: 20, Suction: 20, Rotate: 20, Thrusting: 20, Oscillate: 20, Stroke: 20, Depth: 3, Pump: 3,
};
/** The longest one of them sends may run before the page says it again. */
export const HAND_MAX_SEC = 60;
/** No two of them sends closer together than this. */
export const HAND_MIN_GAP_MS = 250;
let handLastAt = 0;

export interface HandPlay {
  toy?: unknown;
  /** 'Vibrate:5,Fingering:9', or 'Stop'. */
  action?: unknown;
  /** 1 to 4, one of the toy's own stored patterns. */
  preset?: unknown;
  timeSec?: unknown;
}

/** The page's send, checked and shaped, or why not. */
export function shapeHandPlay(body: HandPlay): { ok: true; payload: CloudPayload } | { ok: false; error: string } {
  const out: CloudPayload = {};
  if (body.toy !== undefined && body.toy !== null && body.toy !== '') {
    if (typeof body.toy !== 'string' || !/^[A-Za-z0-9_:-]{1,40}$/.test(body.toy)) return { ok: false, error: 'toy is a Lovense toy id.' };
    out.toy = body.toy;
  }
  const raw = Number(body.timeSec);
  const timeSec = Number.isFinite(raw) ? Math.min(HAND_MAX_SEC, Math.max(1, Math.round(raw))) : 20;
  if (body.preset !== undefined) {
    const n = Number(body.preset);
    const name = PRESETS[n - 1];
    if (!Number.isInteger(n) || !name) return { ok: false, error: 'preset is 1 to 4.' };
    return { ok: true, payload: { ...out, command: 'Preset', name, timeSec } };
  }
  if (body.action === 'Stop') return { ok: true, payload: { ...out, command: 'Function', action: 'Stop', timeSec: 0 } };
  if (typeof body.action !== 'string' || body.action.length > 120) return { ok: false, error: 'action is like Vibrate:5,Fingering:9.' };
  const parts = body.action.split(',');
  const clean: string[] = [];
  for (const part of parts) {
    const m = /^([A-Za-z0-9]+):(\d{1,2})$/.exec(part.trim());
    if (!m || !(m[1] in HAND_ACTIONS)) return { ok: false, error: `Not an action Lovense takes: ${part}` };
    clean.push(`${m[1]}:${Math.min(HAND_ACTIONS[m[1]], Number(m[2]))}`);
  }
  if (clean.length === 0 || clean.length > 4) return { ok: false, error: 'One to four motors in a send.' };
  // stopPrevious 0: change the levels without stopping what is playing first.
  // Lovense's default stops and restarts on every send, which they felt as a
  // pause on every step up. The page names every motor in each send, zeros included.
  return { ok: true, payload: { ...out, command: 'Function', action: clean.join(','), timeSec, stopPrevious: 0 } };
}

/** The page's send down the road. A stop is never refused for pace. */
export async function cloudPlayByHand(body: HandPlay): Promise<{ ok: boolean; error?: string; offline?: boolean; slow?: boolean }> {
  const shaped = shapeHandPlay(body);
  if (!shaped.ok) return { ok: false, error: shaped.error };
  const t = token();
  if (!t) return { ok: false, error: 'No Lovense developer token yet.' };
  const isStop = shaped.payload.action === 'Stop';
  const now = Date.now();
  if (!isStop && now - handLastAt < HAND_MIN_GAP_MS) return { ok: false, slow: true, error: 'Too quick; the page sends again in a moment.' };
  handLastAt = now;
  try {
    const out = await post(`${API}/v2/command`, { token: t, uid: uid(), apiVer: 1, ...shaped.payload });
    if (out.code === 507) return { ok: false, offline: true, error: 'The Lovense app is not linked or not open on the phone.' };
    if (!out.result) return { ok: false, slow: /limit|frequen|too many/i.test(out.message ?? ''), error: out.message || 'Lovense said no.' };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Could not reach Lovense: ${(err as Error).message}` };
  }
}

/** For tests only. */
export function resetHandPaceForTests(): void {
  handLastAt = 0;
}
