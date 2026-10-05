// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Carries what the owner's phone is playing to the house, quietly.
//
// THE ASK: no going out of the app and back in to check, and nothing
// cluttering up the messages app. So this has NO INTERFACE AT ALL. No button,
// no panel, nothing on the chat screen. It runs while the owner has Aerie open and
// posts a small reading; a companion looks at the house rather than asking them
// to fetch a number off another screen.
//
// IT ONLY WORKS BECAUSE OF HOW THE OWNER WATCHES. The show floats in a little window
// over Aerie, which means Aerie is the app in front and its timers keep
// running. An app Android has put to sleep reports nothing, and this says so
// rather than pretending — see stopped-ness in the payload.

import { api } from './api';
import {
  mediaSessionSupported,
  mediaSessionGranted,
  readMediaSessions,
  type MediaSessionReading,
} from './media-session';

/** While something is playing, often enough that a pause is noticed quickly. */
export const PLAYING_INTERVAL_MS = 10_000;
/** While nothing is, rarely enough to be free. */
export const IDLE_INTERVAL_MS = 60_000;

/**
 * Which session to report.
 *
 * Deliberately WIDER than followableSession(): that one picks what the clock
 * may follow and refuses anything without a position, which is right for a
 * clock and wrong for a report. A player that publishes no position is still
 * a fact worth carrying — it is the difference between "the owner stopped watching"
 * and "we cannot see".
 */
export function reportableSession(sessions: MediaSessionReading[]): MediaSessionReading | null {
  if (!sessions.length) return null;
  const ranked = [...sessions].sort((a, b) =>
    (Number(b.state === 'playing') - Number(a.state === 'playing'))
    || (Number(b.reportsPosition) - Number(a.reportsPosition))
    || ((b.durationMs ?? 0) - (a.durationMs ?? 0)));
  return ranked[0];
}

/** How long to wait before the next reading. */
export function intervalFor(session: MediaSessionReading | null): number {
  return session && session.state === 'playing' ? PLAYING_INTERVAL_MS : IDLE_INTERVAL_MS;
}

export function payloadFor(session: MediaSessionReading) {
  return {
    package: session.package,
    state: session.state,
    reportsPosition: session.reportsPosition,
    positionMs: session.positionMs,
    livePositionMs: session.livePositionMs,
    durationMs: session.durationMs,
    speed: session.speed,
    title: session.displayTitle || session.title || null,
  };
}

/**
 * Start reporting. Returns a function that stops it.
 *
 * Every failure here is swallowed on purpose. This is a background courtesy;
 * if it cannot reach the house, or the grant has been revoked, or Android
 * refuses mid-call, the correct behaviour is to go quiet and try again later
 * rather than to put anything at all in front of the owner.
 */
export function startMediaReporter(): () => void {
  if (!mediaSessionSupported()) return () => {};

  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };

  const tick = async () => {
    if (stopped) return;
    let wait = IDLE_INTERVAL_MS;
    try {
      if (document.visibilityState === 'visible' && await mediaSessionGranted()) {
        const { sessions } = await readMediaSessions();
        const session = reportableSession(sessions);
        wait = intervalFor(session);
        if (session) await api.post('/api/media/session', payloadFor(session));
      }
    } catch {
      // Quiet on purpose. See the note above.
    }
    if (!stopped) timer = setTimeout(() => { void tick(); }, wait);
  };

  const onVisibility = () => {
    if (stopped) return;
    if (document.visibilityState === 'visible') { clear(); void tick(); }
  };

  document.addEventListener('visibilitychange', onVisibility);
  void tick();

  return () => {
    stopped = true;
    clear();
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
