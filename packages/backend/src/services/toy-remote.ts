// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Lovense: this file drives Lovense toys. Running Aerie needs your own Lovense
// developer account and token; carrying this code into another project needs
// that project's own agreement and approval from Lovense. See
// packages/phone/android/LOVENSE.md.
// The house's half of the road from a lane to the owner's toys.
//
// A lane asks on the loopback door (POST /api/internal/toys). The ask is
// checked and shaped here, handed to the owner's phone over the socket as a
// toy_command, and the lane gets back what the phone said about it: taken,
// or refused and why. The phone is the side that enforces everything that
// protects the owner (the remote they hand over, their stop, the screen being on,
// every command's own end), so the house never reports a toy as going on its
// own word. A command the phone did not answer comes back as no-answer, and
// the lane is told plainly that nothing it writes is happening.
//
// Kept in memory on purpose: the phone reports its toys whenever they change,
// and a house restart is a moment the owner is not being driven by anything.

import { randomUUID } from 'node:crypto';
import {
  TOY_REMOTE_DEFAULT_MS,
  TOY_REMOTE_MAX_MS,
  TOY_REMOTE_MIN_STEP_MS,
  TOY_REMOTE_TOP_LEVEL,
  type ServerMessage,
  type ToyLightAction,
  type ToyLightAsk,
  type ToyLightPair,
  type ToyPhoneState,
  type ToyRemoteAck,
  type ToyRemoteCommand,
  type ToyStep,
} from '@aerie/shared';
import { registry } from './ws/connection-registry.js';

/** How long the lane waits for the owner's phone to answer before it is told nobody did. */
export const TOY_ACK_WAIT_MS = 8_000;
/** Steps a single track may hold. */
const MAX_STEPS = 600;
/** The most times one command's steps may play through. */
const MAX_LOOPS = 50;

type Shaped = { ok: true; command: ToyRemoteCommand } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function level(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(TOY_REMOTE_TOP_LEVEL, Math.round(n)));
}

function stepMs(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(TOY_REMOTE_MIN_STEP_MS, Math.min(TOY_REMOTE_MAX_MS, Math.round(n)));
}

/** seconds from the lane, or the default, as milliseconds inside the ceiling. */
function lengthMs(seconds: unknown): number | null {
  if (seconds === undefined || seconds === null) return TOY_REMOTE_DEFAULT_MS;
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(TOY_REMOTE_MIN_STEP_MS, Math.min(TOY_REMOTE_MAX_MS, Math.round(n * 1000)));
}

function motorKey(value: unknown): string | null {
  if (value === undefined || value === null) return 'main';
  if (typeof value !== 'string') return null;
  const key = value.trim();
  if (!key || key.length > 40) return null;
  return key;
}

const LIGHT_ACTIONS: readonly ToyLightAction[] = ['on', 'off', 'flash'];
const LIGHT_PAIRS: readonly ToyLightPair[] = ['light', 'alight'];

/** A light ask, checked: on, off or flash, one toy by id or name, and which pair. */
function lightFromLane(body: Record<string, unknown>): { ok: true; light: ToyLightAsk } | { ok: false; error: string } {
  if (body.level !== undefined || body.tracks !== undefined || body.preset !== undefined) {
    return { ok: false, error: 'A light ask goes on its own: send the light and the motion as two asks.' };
  }
  const action = typeof body.light === 'string' ? body.light.trim().toLowerCase() : '';
  if (!LIGHT_ACTIONS.includes(action as ToyLightAction)) return { ok: false, error: 'light is "on", "off" or "flash".' };
  const light: ToyLightAsk = { action: action as ToyLightAction };
  if (body.toy !== undefined && body.toy !== null) {
    const toy = typeof body.toy === 'string' ? body.toy.trim() : '';
    if (!toy || toy.length > 80) return { ok: false, error: 'toy, when given, is a toy\'s id or its name from GET /api/internal/toys.' };
    light.toy = toy;
  }
  if (body.which !== undefined && body.which !== null) {
    const which = typeof body.which === 'string' ? body.which.trim().toLowerCase() : '';
    if (!LIGHT_PAIRS.includes(which as ToyLightPair)) {
      return { ok: false, error: 'which, when given, is "light" (LIGHT_ON and LIGHT_OFF) or "alight" (ALIGHT_ON and ALIGHT_OFF, the Domi\'s).' };
    }
    if (light.action === 'flash') return { ok: false, error: 'which goes with on and off; flash is FLASH on every toy that lists it.' };
    light.which = which as ToyLightPair;
  }
  return { ok: true, light };
}

/**
 * The lane's ask, checked and shaped into what the phone is handed.
 *
 * Five shapes, one per ask:
 *   { companion, stop: true }
 *   { companion, level, motor?, seconds? }      one level held, then off
 *   { companion, tracks: { motor: [[level, ms], ...] }, loops? }
 *   { companion, preset: 1..4, seconds? }       the toy's own pattern
 *   { companion, light: on|off|flash, toy?, which? }   a toy's light, motors untouched
 * toyId is optional on all of them; without it every connected toy that has
 * the motor (or the light) plays it. Levels run 0 to 20 and are clamped, not
 * refused, so a lane that writes 25 gets the top rather than silence.
 */
export function commandFromLane(body: unknown, now: Date = new Date(), id: string = randomUUID()): Shaped {
  if (!isRecord(body)) return { ok: false, error: 'Send a JSON object.' };
  const companion = typeof body.companion === 'string' ? body.companion.trim().toLowerCase() : '';
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(companion)) {
    return { ok: false, error: 'Say which companion is asking: companion is your slug, like "birch".' };
  }
  let toyId: string | undefined;
  if (body.toyId !== undefined && body.toyId !== null) {
    if (typeof body.toyId !== 'string' || !body.toyId.trim()) return { ok: false, error: 'toyId, when given, is a toy id from GET /api/internal/toys.' };
    toyId = body.toyId.trim();
  }
  const base = { id, companion, at: now.toISOString(), ...(toyId ? { toyId } : {}) };

  if (body.stop === true) {
    return { ok: true, command: { ...base, action: 'stop', maxMs: 0 } };
  }

  // A light runs no motor, so it carries no length: maxMs 0.
  if (body.light !== undefined) {
    const shaped = lightFromLane(body);
    if (!shaped.ok) return shaped;
    return { ok: true, command: { ...base, action: 'light', light: shaped.light, maxMs: 0 } };
  }

  if (body.preset !== undefined) {
    const n = Number(body.preset);
    if (!Number.isInteger(n) || n < 1 || n > 4) return { ok: false, error: 'preset is one of the toy\'s own four patterns, 1 to 4.' };
    const ms = lengthMs(body.seconds);
    if (ms === null) return { ok: false, error: 'seconds, when given, is a positive number.' };
    return { ok: true, command: { ...base, action: 'play', preset: n, presetMs: ms, maxMs: ms } };
  }

  if (body.tracks !== undefined) {
    if (!isRecord(body.tracks)) return { ok: false, error: 'tracks maps a motor to its steps: { "main": [[8, 2000], [14, 2000]] }.' };
    const tracks: Record<string, ToyStep[]> = {};
    let longest = 0;
    for (const [rawKey, rawSteps] of Object.entries(body.tracks)) {
      const key = motorKey(rawKey);
      if (!key) return { ok: false, error: `"${rawKey}" is not a motor name.` };
      if (!Array.isArray(rawSteps) || rawSteps.length === 0) return { ok: false, error: `${key} needs at least one [level, ms] step.` };
      if (rawSteps.length > MAX_STEPS) return { ok: false, error: `${key} has ${rawSteps.length} steps; ${MAX_STEPS} is the most one track takes.` };
      const steps: ToyStep[] = [];
      let total = 0;
      for (const raw of rawSteps) {
        if (!Array.isArray(raw) || raw.length !== 2) return { ok: false, error: `Each step of ${key} is [level, ms].` };
        const l = level(raw[0]);
        const ms = stepMs(raw[1]);
        if (l === null || ms === null) return { ok: false, error: `Each step of ${key} is [level, ms] with numbers, ms above zero.` };
        steps.push([l, ms]);
        total += ms;
      }
      tracks[key] = steps;
      longest = Math.max(longest, total);
    }
    if (Object.keys(tracks).length === 0) return { ok: false, error: 'tracks is empty.' };
    let loops = 1;
    if (body.loops !== undefined) {
      const n = Number(body.loops);
      if (!Number.isInteger(n) || n < 1) return { ok: false, error: 'loops is a whole number, 1 or more.' };
      loops = Math.min(MAX_LOOPS, n);
    }
    const maxMs = Math.min(TOY_REMOTE_MAX_MS, longest * loops);
    return { ok: true, command: { ...base, action: 'play', tracks, loops, maxMs } };
  }

  if (body.level !== undefined) {
    const l = level(body.level);
    if (l === null) return { ok: false, error: 'level is a number from 0 to 20.' };
    const key = motorKey(body.motor);
    if (!key) return { ok: false, error: 'motor, when given, is a motor name from GET /api/internal/toys, "main" or "all".' };
    const ms = lengthMs(body.seconds);
    if (ms === null) return { ok: false, error: 'seconds, when given, is a positive number.' };
    return { ok: true, command: { ...base, action: 'play', tracks: { [key]: [[l, ms]] }, loops: 1, maxMs: ms } };
  }

  return { ok: false, error: 'Ask for stop, a level, tracks, or a preset.' };
}

/** A command in a few words, for the log and for the lane's own record. */
export function describeToyCommand(command: ToyRemoteCommand): string {
  const who = command.toyId ? ` on ${command.toyId}` : '';
  if (command.action === 'stop') return `stop${who}`;
  if (command.action === 'light') {
    const light = command.light;
    const pair = light?.which ? ` (${light.which})` : '';
    const toy = light?.toy ? ` on ${light.toy}` : '';
    return `light ${light?.action ?? '?'}${pair}${toy}${who}`;
  }
  if (command.preset) return `preset ${command.preset} for ${Math.round((command.presetMs ?? 0) / 1000)}s${who}`;
  const parts = Object.entries(command.tracks ?? {}).map(([key, steps]) =>
    steps.length === 1 ? `${key} ${steps[0][0]}` : `${key} ${steps.length} steps`,
  );
  const loops = command.loops && command.loops > 1 ? ` x${command.loops}` : '';
  return `${parts.join(', ')}${loops} for up to ${Math.round(command.maxMs / 1000)}s${who}`;
}

// ---- the relay ----

interface Pending {
  resolve: (ack: ToyRemoteAck) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, Pending>();
let phone: { state: ToyPhoneState; receivedAt: number } | null = null;
let last: { command: ToyRemoteCommand; ack: ToyRemoteAck | null; sentAt: number } | null = null;

export interface RelayDeps {
  broadcast: (message: ServerMessage) => void;
  connected: () => boolean;
  waitMs: number;
}

const liveDeps: RelayDeps = {
  broadcast: (message) => registry.broadcast(message),
  connected: () => registry.isUserConnected(),
  waitMs: TOY_ACK_WAIT_MS,
};

/** Hand a command to the owner's phone and wait for its answer. Never throws. */
export function relayToyCommand(command: ToyRemoteCommand, deps: RelayDeps = liveDeps): Promise<ToyRemoteAck> {
  if (!deps.connected()) {
    const ack: ToyRemoteAck = {
      id: command.id,
      ok: false,
      reason: 'no-phone',
      detail: 'The owner\'s app is not connected to the house right now, so nothing reaches the toys.',
    };
    last = { command, ack, sentAt: Date.now() };
    return Promise.resolve(ack);
  }
  last = { command, ack: null, sentAt: Date.now() };
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(command.id);
      const ack: ToyRemoteAck = {
        id: command.id,
        ok: false,
        reason: 'no-answer',
        detail: 'Sent to the owner\'s phone and nothing answered: the app may be closed, behind another app, or not refreshed since this road was built.',
      };
      if (last?.command.id === command.id) last.ack = ack;
      resolve(ack);
    }, deps.waitMs);
    pending.set(command.id, { resolve, timer });
    deps.broadcast({ type: 'toy_command', command });
  });
}

/**
 * The owner's phone's answer to a command. True when it matched one still waiting.
 *
 * An answer that comes after the house stopped waiting is the one dangerous
 * kind: the lane was told nothing answered, so it believes nothing is
 * happening, and if the phone took the command a toy is running that the
 * lane will not write about. So a late answer that says something is playing
 * gets a stop sent straight back.
 *
 * Not for a light answer, though: a light starts nothing, so whatever plays
 * beside it was started by a command the lane does know about, and a stop
 * sent back here would end that instead.
 */
export function recordToyAck(body: unknown, deps: Pick<RelayDeps, 'broadcast'> = liveDeps): boolean {
  if (!isRecord(body) || typeof body.id !== 'string' || typeof body.ok !== 'boolean') return false;
  const ack = body as unknown as ToyRemoteAck;
  if (last?.command.id === ack.id) last.ack = ack;
  const waiting = pending.get(ack.id);
  if (!waiting) {
    if (ack.ok && ack.playing && !ack.light) {
      console.log(`[Toys] a late answer started ${ack.playing.companion}'s command after the lane was told nothing answered; stopping it`);
      deps.broadcast({
        type: 'toy_command',
        command: { id: randomUUID(), companion: ack.playing.companion, at: new Date().toISOString(), action: 'stop', maxMs: 0 },
      });
    }
    return false;
  }
  clearTimeout(waiting.timer);
  pending.delete(ack.id);
  waiting.resolve(ack);
  return true;
}

/** What the owner's phone says about the toys, kept as it was sent. */
export function recordPhoneState(body: unknown): boolean {
  if (!isRecord(body) || (body.gate !== 'open' && body.gate !== 'closed') || !Array.isArray(body.toys)) return false;
  phone = { state: body as unknown as ToyPhoneState, receivedAt: Date.now() };
  return true;
}

/** Everything the lane needs before it writes a word about the owner's toys. */
export function toyRemoteStatus(connected: () => boolean = liveDeps.connected) {
  return {
    phoneConnected: connected(),
    reportedAt: phone ? new Date(phone.receivedAt).toISOString() : null,
    secondsSinceReport: phone ? Math.round((Date.now() - phone.receivedAt) / 1000) : null,
    state: phone?.state ?? null,
    last: last
      ? { command: last.command, said: describeToyCommand(last.command), ack: last.ack, sentAt: new Date(last.sentAt).toISOString() }
      : null,
    how: 'POST /api/internal/toys with { companion, stop: true } | { companion, level, motor?, seconds? } | { companion, tracks: { motor: [[level, ms], ...] }, loops? } | { companion, preset: 1-4, seconds? } | { companion, light: "on" | "off" | "flash", toy?, which? }. Levels 0-20; one command runs at most 180 seconds; a new play replaces the last. A light ask never touches the motors, so it neither stops nor replaces what is playing, and it goes through the same remote, stop, screen and orbs as motion: toy is one toy\'s id or name (without it, every connected toy that has the light), each toy\'s light commands are in state.toys[].lights, which is "light" (LIGHT_ON/LIGHT_OFF) or "alight" (ALIGHT_ON/ALIGHT_OFF, the Domi\'s; by default a toy that lists ALIGHT uses it), flash is FLASH, and the answer\'s light.took and light.refused say toy by toy what happened. state.toys[].battery is the toy\'s own last answer, 0-100, with batteryAt (when it answered) and batteryWorking (it answered while running, which Lovense says can read off); a toy with no battery has not answered since their app started, which is not the same as empty.',
  };
}

/** For tests: forget everything. */
export function resetToyRemoteForTests(): void {
  for (const waiting of pending.values()) clearTimeout(waiting.timer);
  pending.clear();
  phone = null;
  last = null;
}
