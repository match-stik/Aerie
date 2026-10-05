// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// What the owner's phone is currently playing — the Screening Room's other half.
//
// No streaming service will tell a server where the owner is in an episode; that is
// a wall on their side and it is why the original build this came from lists
// manual synchronisation as its first limit. The owner's PHONE is a different matter:
// Android keeps a list of what is playing so a lock screen can show a pause
// button, and an app holding the notification-listener grant can read it.
//
// THIS IS AN INSTRUMENT BEFORE IT IS A FEATURE. Nothing on the server can find
// out whether the OWNER'S player publishes a position — some do, some refuse, and the
// only way to know is to look on the device in their hand. So everything here
// reports what Android actually said, including "this player does not say",
// rather than filling a gap with a guess.

import { Capacitor, registerPlugin } from '@capacitor/core';

export interface MediaSessionReading {
  /** The app doing the playing, e.g. com.hulu.plus. */
  package: string;
  title?: string | null;
  displayTitle?: string | null;
  subtitle?: string | null;
  artist?: string | null;
  album?: string | null;
  durationMs?: number | null;
  state: 'playing' | 'paused' | 'buffering' | 'stopped' | 'none' | string;
  /** THE QUESTION THIS WHOLE THING EXISTS TO ANSWER. */
  reportsPosition: boolean;
  /** The reading as taken, at positionReadAt. */
  positionMs?: number;
  /** That reading carried forward to now while it is playing. */
  livePositionMs?: number;
  speed?: number;
  positionReadAt?: number;
  /** Set when the native side refused to carry a stale reading forward. */
  driftRejected?: boolean;
}

export interface MediaSessionResult {
  granted: boolean;
  sessions: MediaSessionReading[];
}

interface MediaSessionBridge {
  hasAccess(): Promise<{ granted: boolean }>;
  openSettings(): Promise<void>;
  read(): Promise<MediaSessionResult>;
}

const plugin = registerPlugin<MediaSessionBridge>('MediaSession');

/** Android only. On the web there is nothing to read and we say so plainly. */
export function mediaSessionSupported(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export async function mediaSessionGranted(): Promise<boolean> {
  if (!mediaSessionSupported()) return false;
  try {
    return (await plugin.hasAccess()).granted;
  } catch {
    return false;
  }
}

/**
 * Android will not put this grant in a dialog — it is only reachable from its
 * own settings page, the same as always-on location. Say what it buys, then
 * open the page; never pretend to ask.
 */
// NO CALLER ON PURPOSE. The Media tab that used to call this was scrapped
// deliberately, once it had answered the one question it existed to ask — does the
// player publish a position. It does. This stays because the
// permission can still be revoked by a reinstall or an Android update, and when
// that happens the route back has to exist somewhere other than a deleted file.
export async function openMediaSessionSettings(): Promise<void> {
  if (!mediaSessionSupported()) return;
  await plugin.openSettings();
}

export async function readMediaSessions(): Promise<MediaSessionResult> {
  if (!mediaSessionSupported()) return { granted: false, sessions: [] };
  try {
    return await plugin.read();
  } catch {
    return { granted: false, sessions: [] };
  }
}

/**
 * Pick the session worth following: something actually playing, that reports a
 * position, with the longest runtime — a 40-minute episode beats a notification
 * chime. Returns null rather than a best guess, because a wrong clock is worse
 * than an honest absence.
 */
export function followableSession(sessions: MediaSessionReading[]): MediaSessionReading | null {
  const usable = sessions.filter((s) => s.reportsPosition && (s.state === 'playing' || s.state === 'paused'));
  if (!usable.length) return null;
  return usable.sort((a, b) =>
    (Number(b.state === 'playing') - Number(a.state === 'playing'))
    || ((b.durationMs ?? 0) - (a.durationMs ?? 0)))[0];
}

/**
 * The most drift a single reading is allowed to be carried forward by. A media
 * session that has not updated in ten minutes is not a slow reading, it is two
 * clocks disagreeing, and the raw number is the only honest thing left.
 */
export const MAX_DRIFT_MS = 10 * 60 * 1000;

/**
 * What position to actually believe.
 *
 * THIS EXISTS BECAUSE THE FIRST LIVE READING THIS HOUSE EVER TOOK WAS WRONG BY
 * THE AGE OF THE UNIX EPOCH. The native side stamps its reading on the
 * since-boot clock; compare that against wall-clock time and you get a position
 * of 497,019 hours, printed with total confidence. The cause is fixed. This is
 * the net under the fix, and it does not care WHICH clock went wrong — it only
 * asks whether the carried-forward number is still a plausible description of
 * an episode, and hands back the raw reading when it is not.
 *
 * Returns null when the player publishes no position at all. A missing number
 * is a fact; an invented one is a lie the Screening Room would act on.
 */
export function positionOfReading(s: MediaSessionReading | null | undefined): number | null {
  if (!s || !s.reportsPosition || typeof s.positionMs !== 'number' || s.positionMs < 0) return null;
  const raw = s.positionMs;
  const live = s.livePositionMs;
  if (typeof live !== 'number' || !Number.isFinite(live)) return raw;
  const drift = live - raw;
  // Time does not run backwards inside one reading, and it does not run for
  // longer than anybody waits between taps.
  if (drift < 0 || drift > MAX_DRIFT_MS) return raw;
  // A position past the end of the episode is not a position.
  const duration = s.durationMs;
  if (typeof duration === 'number' && duration > 0 && live > duration) return Math.min(raw, duration);
  return live;
}
