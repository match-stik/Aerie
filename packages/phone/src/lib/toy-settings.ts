// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Each toy's own settings, kept on their phone: how strong each motor is
// allowed to go, how many of its own patterns it keeps, and whether they have
// taken it off their list (theirs, Nov 10 2026, after Lovense's per-toy settings
// pages: Toy Strength, Program, Delete Toy).
//
// The strength is a scale, not a ceiling: a motor set to half makes every
// level half as strong, so a pattern keeps its shape and only gets gentler.
// It is applied where every level leaves for the toy (aerie/lovense-toys.ts),
// so their hand, the orbs, the shelf and a lane's play are all held to it alike.
// Kept free of imports so it can be tested without the app around it.

export interface ToySettings {
  /** Per motor command, the strength out of 20 that a full 20 becomes. */
  strength?: Record<string, number>;
  /** How many of its own patterns the toy keeps, when they have said. */
  presets?: number;
}

export interface ToySettingsStore {
  get(toyId: string): ToySettings;
  setStrength(toyId: string, command: string, max: number): void;
  setPresets(toyId: string, count: number | null): void;
  forget(toyId: string): void;
  remember(toyId: string): void;
  forgotten(toyId: string): boolean;
  scale(toyId: string, command: string, level: number): number;
  subscribe(fn: () => void): () => void;
  version(): number;
}

/** The commands that move a motor. Patterns by number, lights and questions
 *  are never scaled. */
export const SCALED_COMMANDS = new Set([
  'VIBRATE', 'VIBRATE1', 'VIBRATE2', 'VIBRATE3',
  'ROTATE', 'ROTATE_CLOCKWISE', 'ROTATE_ANTI_CLOCKWISE',
  'THRUST', 'FLEXER_VIBRATE', 'FLEXER_FINGER', 'OSCILLATE',
]);

export const PRESETS_MAX = 10;

/** A level as the toy should get it under a strength out of 20. Anything
 *  above zero stays above zero, so a gentle setting never turns a motor off. */
export function scaleLevel(level: number, max: number | undefined): number {
  if (!Number.isFinite(level) || level <= 0) return 0;
  if (max === undefined || !Number.isFinite(max) || max >= 20) return level;
  const top = Math.max(1, Math.min(20, Math.round(max)));
  return Math.max(1, Math.round((level * top) / 20));
}

interface Saved {
  toys: Record<string, ToySettings>;
  forgotten: string[];
}

export function createToySettings(storage: { read(): string | null; write(text: string): void }): ToySettingsStore {
  let saved: Saved = { toys: {}, forgotten: [] };
  try {
    const raw = storage.read();
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Saved>;
      saved = {
        toys: parsed.toys && typeof parsed.toys === 'object' ? parsed.toys : {},
        forgotten: Array.isArray(parsed.forgotten) ? parsed.forgotten.filter((id) => typeof id === 'string') : [],
      };
    }
  } catch {
    // An unreadable record starts clean: every toy at full strength and on the list.
  }
  let ver = 0;
  const listeners = new Set<() => void>();
  const changed = () => {
    ver++;
    try {
      storage.write(JSON.stringify(saved));
    } catch {
      // Kept for this session even if the phone would not save it.
    }
    for (const fn of listeners) fn();
  };
  const toy = (toyId: string): ToySettings => (saved.toys[toyId] ??= {});

  return {
    get: (toyId) => saved.toys[toyId] ?? {},
    setStrength(toyId, command, max) {
      const t = toy(toyId);
      const clean = Math.max(1, Math.min(20, Math.round(max)));
      t.strength = { ...t.strength, [command]: clean };
      if (clean === 20) delete t.strength[command];
      changed();
    },
    setPresets(toyId, count) {
      const t = toy(toyId);
      if (count === null) delete t.presets;
      else t.presets = Math.max(0, Math.min(PRESETS_MAX, Math.round(count)));
      changed();
    },
    forget(toyId) {
      if (!saved.forgotten.includes(toyId)) saved.forgotten = [...saved.forgotten, toyId];
      changed();
    },
    remember(toyId) {
      if (!saved.forgotten.includes(toyId)) return;
      saved.forgotten = saved.forgotten.filter((id) => id !== toyId);
      changed();
    },
    forgotten: (toyId) => saved.forgotten.includes(toyId),
    scale(toyId, command, level) {
      if (!SCALED_COMMANDS.has(command)) return level;
      return scaleLevel(level, saved.toys[toyId]?.strength?.[command]);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    version: () => ver,
  };
}

const KEY = 'aerie.toy-settings.v1';

/** The phone's one copy. */
export const toySettings = createToySettings({
  read: () => {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  write: (text) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, text);
  },
});
