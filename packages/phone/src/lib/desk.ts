// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The house on a wide screen, apart from drawing it (theirs, Nov 14 2026: the
// phone 'doesn't really read well on the laptop'). At laptop width the dock
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
  /** Where the dock stands: down the left, or as a bar along the bottom or the top (theirs, Nov 15 2026). */
  dock: DeskDock;
  /** Which side the conversation sits on, or null while it is tucked away and opens like any other room. */
  chat: 'right' | 'left' | null;
}

/** The phone, as it always was. */
export const PHONE_DESK: Desk = { on: false, rail: false, dock: 'left', chat: null };

export function deskLayoutOf(value: unknown): DeskLayout {
  return value === 'phone' ? 'phone' : 'study';
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

/** The laptop's text size (theirs, Nov 15 2026: the smallest, and leave it at that). */
export const DESK_TEXT_SCALE = 0.85;

/**
 * The shape of the room the laptop wallpaper sits behind, width over height,
 * so a picture cropped to it fills the room with no blurred band (theirs, Nov 15
 * 2026: 'not sure what aspect ratio we'd need'). Null when it cannot be read.
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

/** What the window gets: the Study on a wide one unless they chose the phone, the phone on a narrow one whatever they chose. */
export function deskOf(theme: { deskLayout?: unknown; deskDock?: unknown; deskChat?: unknown }, width: number): Desk {
  if (!(width >= DESK_MIN_WIDTH) || deskLayoutOf(theme.deskLayout) === 'phone') return PHONE_DESK;
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
