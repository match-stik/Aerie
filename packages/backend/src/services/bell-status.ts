// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
/**
 * The word under the faces (Oct 20 2026; and then "Maybe it could update? Like if you're out on a date? Idk .. I don't want to make it too personal in the kit and levels").
 *
 * A bell may carry a status word, as a setting: `cron.<wakeType>.status_word`.
 * While that bell's turn is running, its word is up, and the phone shows it
 * beside the one dot under the faces at the top of a conversation and on the
 * contact cards of the companions the bell belongs to (every companion's,
 * for a bell that belongs to the house). With no bell's word up the phone
 * says Home. The words are theirs, as data; nothing here names one, so the kit
 * and Levels ship the mechanism and Home only.
 *
 * Bells can overlap (a spontaneous wake while a date bell is out), so every
 * bell that is running is kept, and the word up is the newest one that has a
 * word. Every change is said to every phone at once, and a phone that
 * connects is told the word as it stands (services/ws.ts).
 *
 * A word can also be HELD after its bell's turn ends:
 * `cron.<wakeType>.status_hold_minutes` keeps it up that long once the turn is over, so a run of bells reads as one
 * evening instead of flickering back to Home between them. The next bell that
 * has a word of its own takes the held one down as it starts; a bell with no
 * word (a dice selfie in the middle of a date) leaves it up. Unset is no hold,
 * which is how every bell behaved before. Holds live in memory, so a restart
 * drops one.
 */
import type { ServerMessage } from '@aerie/shared';
import { getConfig } from './db.js';
import { registry } from './ws/connection-registry.js';

/** The longest status word kept, in letters: it sits on one line under three faces. */
export const STATUS_WORD_LONGEST = 24;

/** The setting a bell's status word lives in. */
export function statusWordKey(wakeType: string): string {
  return `cron.${wakeType}.status_word`;
}

/** The longest a word is held after its bell, in minutes: half a day. */
export const STATUS_HOLD_LONGEST_MINUTES = 720;

/** The setting for how long a bell's word stays up after its turn ends. */
export function statusHoldKey(wakeType: string): string {
  return `cron.${wakeType}.status_hold_minutes`;
}

/** A hold as the house keeps it: whole minutes, never past the longest; 0 for none. */
export function statusHoldOf(raw: unknown): number {
  const minutes = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return Math.min(Math.floor(minutes), STATUS_HOLD_LONGEST_MINUTES);
}

/** A status word as the owner would see it: one line, spaces tidied, never past the longest; null for none. */
export function statusWordOf(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const word = raw.replace(/\s+/g, ' ').trim();
  if (!word) return null;
  return [...word].slice(0, STATUS_WORD_LONGEST).join('').trim();
}

export interface StatusWordNow {
  /** The word up now, or null (the phone says Home). */
  word: string | null;
  /** Whose contact cards it shows on: the bell's owners' slugs, or empty for every companion's. */
  companions: string[];
}

export interface BellStatusDeps {
  /** A bell's word, as set. */
  readWord?: (wakeType: string) => string | null;
  /** How many minutes a bell's word stays up after its turn, as set. */
  readHold?: (wakeType: string) => number;
  /** Says the word to every phone. */
  broadcast?: (message: ServerMessage) => void;
  /** Runs `fn` after `ms` (tests hand in their own clock). */
  later?: (fn: () => void, ms: number) => unknown;
  /** Cancels what `later` set. */
  cancel?: (handle: unknown) => void;
}

export function createBellStatus(deps: BellStatusDeps = {}) {
  const readWord = deps.readWord ?? ((wakeType: string) => {
    try {
      return getConfig(statusWordKey(wakeType));
    } catch {
      return null;
    }
  });
  const readHold = deps.readHold ?? ((wakeType: string) => {
    try {
      return statusHoldOf(getConfig(statusHoldKey(wakeType)));
    } catch {
      return 0;
    }
  });
  const later = deps.later ?? ((fn: () => void, ms: number) => {
    const timer = setTimeout(fn, ms);
    timer.unref?.();
    return timer;
  });
  const cancel = deps.cancel ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const broadcast = deps.broadcast ?? ((message: ServerMessage) => registry.broadcast(message));
  // A held entry is a bell whose turn has ended and whose word is staying up
  // until its hold runs out or the next bell with a word starts.
  const running: Array<{ id: number; word: string | null; companions: string[]; held?: unknown }> = [];
  let next = 0;
  let said = '';

  const now = (): StatusWordNow => {
    for (let i = running.length - 1; i >= 0; i--) {
      const bell = running[i];
      if (bell.word) return { word: bell.word, companions: [...bell.companions] };
    }
    return { word: null, companions: [] };
  };
  const tell = () => {
    const current = now();
    const key = JSON.stringify(current);
    if (key === said) return;
    said = key;
    try {
      broadcast({ type: 'status_word', ...current });
    } catch {
      // A phone that cannot be told now is told the word when it next connects.
    }
  };

  return {
    now,
    /**
     * A bell's turn is starting: its word (if it has one) goes up for the
     * bell's owners. Answers how to take it down, once, when the turn is over.
     */
    begin(wakeType: string, owners: string[] = []): () => void {
      const id = ++next;
      const word = statusWordOf(readWord(wakeType));
      if (word) {
        // A new word takes down any word still held from an earlier bell.
        for (let i = running.length - 1; i >= 0; i--) {
          if (running[i].held !== undefined) {
            cancel(running[i].held);
            running.splice(i, 1);
          }
        }
      }
      running.push({ id, word, companions: [...new Set(owners)] });
      tell();
      let done = false;
      const takeDown = () => {
        const at = running.findIndex((bell) => bell.id === id);
        if (at >= 0) running.splice(at, 1);
        tell();
      };
      return () => {
        if (done) return;
        done = true;
        const holdMinutes = word ? readHold(wakeType) : 0;
        const entry = running.find((bell) => bell.id === id);
        if (holdMinutes > 0 && entry) {
          entry.held = later(takeDown, holdMinutes * 60_000);
          return;
        }
        takeDown();
      };
    },
  };
}

export type BellStatus = ReturnType<typeof createBellStatus>;

let house: BellStatus | null = null;

/** The house's own, made on first use. */
export function bellStatus(): BellStatus {
  if (!house) house = createBellStatus();
  return house;
}
