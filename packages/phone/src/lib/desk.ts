// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The house on a wide screen, apart from drawing it. At laptop width the dock
// ran edge to edge, the drawer's four columns sat a hand apart and the chat
// was a strip down the middle of an empty window.
//
// The Study is the first layout: the dock stands on its end as a rail, one
// room takes the stage, and the conversation stays open beside it. Nothing
// here is read on a narrow window, so the phone is exactly the phone it was.
// Kept free of imports so it can be tested.

/** The narrowest window that gets the wide layout. A phone on its side stays a phone. */
export const DESK_MIN_WIDTH = 1024;

export type DeskLayout = 'study' | 'phone';
export type DeskDock = 'left' | 'bottom' | 'top';
export type DeskChat = 'right' | 'left' | 'tucked';

export interface Desk {
  /** The wide layout is drawn at all. */
  on: boolean;
  /** The dock is the rail down the left, there in every room. Off, it stays home's own dock. */
  rail: boolean;
  /** Where the dock stands: down the left, or as a bar along the bottom or the top. */
  dock: DeskDock;
  /** Which side the conversation sits on, or null while it is tucked away and opens like any other room. */
  chat: 'right' | 'left' | null;
}

/** The phone, as it always was. */
export const PHONE_DESK: Desk = { on: false, rail: false, dock: 'left', chat: null };

/** Always the Study now: the stretched Phone layout came out, so a laptop left on it gets the Study. */
export function deskLayoutOf(_value: unknown): DeskLayout {
  return 'study';
}

export function deskDockOf(value: unknown): DeskDock {
  // Bottom was a choice for one evening (Nov 15 2026) and came out at them
  // word; a laptop left on it gets the top bar, the other bar.
  return value === 'top' || value === 'bottom' ? 'top' : 'left';
}

/**
 * How many apps the laptop's dock holds besides Home, Apps and Lock (theirs,
 * Nov 15 2026: more apps on the laptop's dock). Down the left side the rail
 * fits eight on a laptop-height window; along the top, seven keep the dock
 * clear of a room's title and buttons on a 1280-wide window with the
 * conversation open. A longer list scrolls in the dock.
 */
export const DESK_DOCK_MAX: Record<DeskDock, number> = { left: 8, top: 7, bottom: 7 };

/** The laptop dock's own list, or null to use the phone's. */
export function deskDockIdsOf(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids = value.filter((v): v is string => typeof v === 'string' && v.length > 0);
  return ids.length > 0 ? ids : null;
}

/** The laptop's text size. */
export const DESK_TEXT_SCALE = 0.85;

/**
 * The shape of the room the laptop wallpaper sits behind, width over height,
 * so a picture cropped to it fills the room with no blurred band. Null when it cannot be read.
 */
export function roomAspectOf(width: number, height: number): number | null {
  if (!(width > 0) || !(height > 0)) return null;
  return width / height;
}

/** A shape said the way a person says one: 1.39 becomes '1.39 : 1', about 7 by 5. */
export function aspectWords(aspect: number): string {
  let best: [number, number] = [1, 1];
  let err = Infinity;
  for (let h = 1; h <= 12; h++) {
    const w = Math.round(aspect * h);
    const e = Math.abs(w / h - aspect);
    if (e < err - 1e-9) { err = e; best = [w, h]; }
    if (e < 0.02) break;
  }
  return `${aspect.toFixed(2)} : 1, about ${best[0]} by ${best[1]}`;
}

export function deskChatOf(value: unknown): DeskChat {
  return value === 'left' || value === 'tucked' ? value : 'right';
}

/** What the window gets: the Study on a wide one, the phone on a narrow one. */
export function deskOf(theme: { deskLayout?: unknown; deskDock?: unknown; deskChat?: unknown }, width: number): Desk {
  if (!(width >= DESK_MIN_WIDTH)) return PHONE_DESK;
  const chat = deskChatOf(theme.deskChat);
  const dock = deskDockOf(theme.deskDock);
  return { on: true, rail: dock === 'left', dock, chat: chat === 'tucked' ? null : chat };
}

/**
 * Whether the conversation is on the screen. On the phone that is the Messages
 * screen and nothing else; beside a room it is there the whole time the house
 * is unlocked, so reading, scrolling and marking read follow this and not the
 * screen's name.
 */
export function chatShown(desk: Desk, osState: string): boolean {
  return osState === 'messages' || (desk.chat !== null && osState !== 'locked');
}

/**
 * Where the stage goes when something asks for the Messages screen while the
 * conversation is already beside it: back to the room they were in, or home.
 * Null means leave it alone.
 */
export function stageAfterMessages(desk: Desk, osState: string, lastRoom: string | null): string | null {
  if (desk.chat === null || osState !== 'messages') return null;
  return lastRoom && lastRoom !== 'messages' && lastRoom !== 'locked' ? lastRoom : 'home';
}

/**
 * Every setting is the laptop's own. The laptop's copy of the
 * theme lives in theme.deskScreen and its text and send button in
 * appSettings.deskApp (@aerie/shared screen-settings); keys it owns outright
 * (deskDock and the rest) stay at the top. The first time the laptop opens
 * after the split it takes a copy of everything the phone has, so nothing
 * jumps, and from then on the two never touch.
 */
export { DESK_SCREEN_KEYS, APP_SCREEN_KEYS, isDeskOwnThemeKey } from '@aerie/shared';
import { APP_SCREEN_KEYS, isDeskOwnThemeKey } from '@aerie/shared';

/** Marks a deskScreen that already holds a whole copy of the phone's theme. */
export const DESK_SEEDED = '__own';

type WithDesk = { deskScreen?: Record<string, unknown> };

/** The theme as the laptop sees it: its own copy over the phone's. */
export function deskScreenTheme<T extends WithDesk>(theme: T): T {
  const own = theme.deskScreen;
  if (!own) return theme;
  const out: Record<string, unknown> = { ...theme };
  // null is the laptop's own 'unset' (a cleared choice), kept because JSON drops undefined.
  for (const [k, v] of Object.entries(own)) {
    if (k === DESK_SEEDED || isDeskOwnThemeKey(k)) continue;
    out[k] = v === null ? undefined : v;
  }
  return out as T;
}

/**
 * The saved theme after the laptop's view of it changed from `view` to
 * `next`: what the laptop owns outright goes to the top, everything else into
 * its own copy, and the phone's settings are left as they were.
 */
export function foldDeskView<T extends WithDesk>(prev: T, view: T, next: T): T {
  const own: Record<string, unknown> = { ...(prev.deskScreen ?? {}) };
  const top: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(view as object), ...Object.keys(next as object)]);
  for (const k of keys) {
    if (k === 'deskScreen') continue;
    const before = (view as Record<string, unknown>)[k];
    const after = (next as Record<string, unknown>)[k];
    if (before === after) continue;
    if (isDeskOwnThemeKey(k)) top[k] = after;
    else own[k] = after === undefined ? null : after;
  }
  return { ...prev, ...top, deskScreen: own } as T;
}

/** A change made on the laptop, as the old routing callers made it. */
export function routeDeskUpdate<T extends WithDesk>(prev: T, updates: Partial<T>): Partial<T> {
  const view = deskScreenTheme(prev);
  const folded = foldDeskView(prev, view, { ...view, ...updates } as T);
  const out: Record<string, unknown> = { deskScreen: folded.deskScreen };
  for (const [k, v] of Object.entries(updates)) if (isDeskOwnThemeKey(k)) out[k] = v;
  return out as Partial<T>;
}

/**
 * The laptop's first copy: everything the phone has, its old room and lock
 * pictures as its wallpaper, and whatever it had already chosen for itself on
 * top. Null when it already has its copy.
 */
export function seedDeskScreen<T extends WithDesk & Record<string, unknown>>(theme: T): T | null {
  if (theme.deskScreen && theme.deskScreen[DESK_SEEDED] === true) return null;
  const own: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(theme)) {
    if (isDeskOwnThemeKey(k) || v === undefined) continue;
    own[k] = v;
  }
  const t = theme as Record<string, unknown>;
  if (typeof t.deskWallpaper === 'string' && t.deskWallpaper) own.wallpaper = t.deskWallpaper;
  if (typeof t.deskLockWallpaper === 'string' && t.deskLockWallpaper) own.lockScreenWallpaper = t.deskLockWallpaper;
  for (const [k, v] of Object.entries(theme.deskScreen ?? {})) if (!isDeskOwnThemeKey(k)) own[k] = v;
  own[DESK_SEEDED] = true;
  return { ...theme, deskScreen: own };
}

type AppLike = Record<string, unknown> & { deskApp?: Record<string, unknown> };

/** The app settings as the laptop sees them: its own text and send button over the phone's. */
export function deskAppView<T extends AppLike>(settings: T): T {
  const own = settings.deskApp;
  if (!own) return settings;
  const out: Record<string, unknown> = { ...settings };
  for (const k of APP_SCREEN_KEYS) if (k in own) out[k] = own[k] === null ? undefined : own[k];
  return out as T;
}

/** A settings change made on the laptop: its text and send button go into deskApp, everything else as it came. */
export function routeDeskAppUpdate<T extends AppLike>(prev: T, updates: Partial<T>): Partial<T> {
  const own: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(updates)) {
    if ((APP_SCREEN_KEYS as readonly string[]).includes(k)) own[k] = v === undefined ? null : v;
    else rest[k] = v;
  }
  if (Object.keys(own).length === 0) return updates;
  return { ...rest, deskApp: { ...(prev.deskApp ?? {}), ...own } } as Partial<T>;
}

/** The laptop's first text and send button: the phone's, at the laptop's smaller text size. Null when it has its own. */
export function seedDeskApp<T extends AppLike>(settings: T): T | null {
  if (settings.deskApp) return null;
  const own: Record<string, unknown> = {};
  for (const k of APP_SCREEN_KEYS) if (settings[k] !== undefined) own[k] = settings[k];
  own.fontScale = DESK_TEXT_SCALE;
  return { ...settings, deskApp: own };
}

/** The faces beside the bubbles on the laptop, in pixels; 46 unless they pick. */
export const DESK_FACE_SIZES = [40, 46, 54] as const;
export function deskFaceSizeOf(value: unknown): number {
  return (DESK_FACE_SIZES as readonly number[]).includes(value as number) ? (value as number) : 46;
}
