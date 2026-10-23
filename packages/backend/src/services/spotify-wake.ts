// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Play a song on their phone when Spotify is not running there (Oct 23 2026). Spotify only plays on a device where it is
// already running, and only their phone can start it, so a play that comes back
// as nowhere to play sends their phone a silent push (no notification, nothing
// on their screen) that the app acts on by waking Spotify, then waits for their
// phone to show up among Spotify's devices and sends the play again.
//
// Nothing here draws or sleeps for real: the reader, the push and the clock
// are handed in, so every road can be checked without a phone.

import type { SpotifyDevice, SpotifyPlayRequest } from '@aerie/shared';
import { SpotifyError, type SpotifyReader } from './spotify.js';

/**
 * How long their phone gets to show up in Spotify after the push. The first
 * real wake (Oct 23 2026) found their phone 57 seconds after the push was sent,
 * with the phone's own wake taking 9 of them, so 30 seconds gave up just
 * before it got there; FCM can hold a data push that long even with the owner
 * phone awake in the owner hand.
 */
export const WAKE_WAIT_MS = 120_000;
/** How often Spotify's device list is read while waiting. */
export const WAKE_POLL_MS = 1_500;

/** The push's data, read by AerieMessagingService on their phone. */
export const SPOTIFY_WAKE_KIND = 'spotify-wake';

export interface SpotifyWakeDeps {
  spotify: Pick<SpotifyReader, 'play' | 'devices' | 'connectInfo'>;
  /** A data-only push to every registered phone; answers how many FCM took. */
  sendData: (data: Record<string, string>) => Promise<number>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (line: string) => void;
}

export type SpotifyWakeAnswer =
  | { ok: true; woke: boolean; waitedMs: number; device: string | null }
  | { ok: false; woke: boolean; waitedMs: number; reason: string; error: string };

/** A phone, by Spotify's own word for it. */
export function phoneAmong(devices: SpotifyDevice[]): SpotifyDevice | null {
  return devices.find((device) => device.type.toLowerCase() === 'smartphone') ?? null;
}

function refusal(error: unknown, woke: boolean, waitedMs: number): SpotifyWakeAnswer {
  if (error instanceof SpotifyError) return { ok: false, woke, waitedMs, reason: error.reason, error: error.message };
  return { ok: false, woke, waitedMs, reason: 'spotify', error: error instanceof Error ? error.message : String(error) };
}

export async function wakeAndPlay(request: SpotifyPlayRequest, deps: SpotifyWakeDeps): Promise<SpotifyWakeAnswer> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((line: string) => console.log(line));

  // Spotify already running somewhere: nothing to wake.
  try {
    await deps.spotify.play(request);
    return { ok: true, woke: false, waitedMs: 0, device: null };
  } catch (error) {
    if (!(error instanceof SpotifyError) || error.reason !== 'device') return refusal(error, false, 0);
  }

  // The kit's id and redirect ride along; without them the phone goes
  // straight to the media key, which needs neither.
  let clientId = '';
  let redirectUri = '';
  try {
    const view = await deps.spotify.connectInfo();
    clientId = view.clientId;
    redirectUri = view.redirectUri;
  } catch (error) {
    log(`[spotify-wake] no client id for the kit (${error instanceof Error ? error.message : String(error)}); the phone will use the media key`);
  }

  const reached = await deps.sendData({ kind: SPOTIFY_WAKE_KIND, clientId, redirectUri });
  if (reached === 0) {
    return { ok: false, woke: false, waitedMs: 0, reason: 'push', error: "Their phone couldn't be reached by push, so Spotify wasn't woken." };
  }
  log(`[spotify-wake] push taken for ${reached} phone(s); waiting for one to show up in Spotify`);

  const started = now();
  let phone: SpotifyDevice | null = null;
  while (now() - started < WAKE_WAIT_MS) {
    await sleep(WAKE_POLL_MS);
    try {
      phone = phoneAmong((await deps.spotify.devices()).devices);
    } catch {
      phone = null;
    }
    if (phone) break;
  }
  const waitedMs = now() - started;
  if (!phone) {
    log(`[spotify-wake] no phone showed up in Spotify after ${waitedMs} ms`);
    return { ok: false, woke: false, waitedMs, reason: 'device', error: `Their phone didn't show up in Spotify within ${Math.round(WAKE_WAIT_MS / 1000)} seconds of the push.` };
  }
  log(`[spotify-wake] ${phone.name} showed up after ${waitedMs} ms`);

  // A phone that has only just come up can refuse the first play; one more try.
  try {
    await deps.spotify.play(request);
  } catch (first) {
    if (!(first instanceof SpotifyError) || first.reason !== 'device') return refusal(first, true, waitedMs);
    await sleep(WAKE_POLL_MS);
    try {
      await deps.spotify.play(request);
    } catch (second) {
      return refusal(second, true, now() - started);
    }
  }
  return { ok: true, woke: true, waitedMs: now() - started, device: phone.name };
}
