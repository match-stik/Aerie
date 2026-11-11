// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Playing on their phone with Spotify closed (Oct 23 2026): a play with nowhere
// to play sends a silent push, waits for their phone to show up in Spotify, and
// plays again; anything else is answered plainly and never pushed.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { SpotifyDevice } from '@aerie/shared';
import { SpotifyError } from './spotify.js';
import { phoneAmong, SPOTIFY_WAKE_KIND, WAKE_POLL_MS, WAKE_WAIT_MS, wakeAndPlay, type SpotifyWakeDeps } from './spotify-wake.js';

const PHONE: SpotifyDevice = { id: 'p1', name: 'pixel 9 pro', type: 'Smartphone', active: false, volume: 100 };
const LAPTOP: SpotifyDevice = { id: 'c1', name: 'laptop', type: 'Computer', active: false, volume: 50 };
const nowhere = () => new SpotifyError('device', 'Open Spotify on your phone first, then try again.');

/** A pretend house: plays refuse until the phone shows up after `phoneAfterPolls` reads. */
function house(options: { phoneAfterPolls?: number; pushTaken?: number; firstPlay?: () => void; connectFails?: boolean } = {}) {
  let clock = 0;
  let polls = 0;
  let plays = 0;
  const pushes: Array<Record<string, string>> = [];
  const phoneUp = () => options.phoneAfterPolls !== undefined && polls >= options.phoneAfterPolls;
  const deps: SpotifyWakeDeps = {
    spotify: {
      async play() {
        plays++;
        if (plays === 1 && options.firstPlay) return options.firstPlay() as never;
        if (!phoneUp()) throw nowhere();
        return { ok: true };
      },
      async devices() {
        polls++;
        return { devices: phoneUp() ? [LAPTOP, PHONE] : [LAPTOP] };
      },
      async connectInfo() {
        if (options.connectFails) throw new Error('no sign-in page');
        return { clientId: 'cid', redirectUri: 'aerie://spotify' };
      },
    },
    async sendData(data) {
      pushes.push(data);
      return options.pushTaken ?? 1;
    },
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
    log: () => {},
  };
  return { deps, pushes, counts: () => ({ polls, plays }) };
}

test('a phone is found by Spotify\'s own word for it, whatever the case', () => {
  assert.equal(phoneAmong([LAPTOP, PHONE])?.id, 'p1');
  assert.equal(phoneAmong([{ ...PHONE, type: 'smartphone' }])?.id, 'p1');
  assert.equal(phoneAmong([LAPTOP]), null);
});

test('Spotify already running: it plays, and nothing is pushed', async () => {
  const h = house({ firstPlay: () => ({ ok: true }) as never });
  const answer = await wakeAndPlay({ trackUri: 'spotify:track:abc' }, h.deps);
  assert.deepEqual(answer, { ok: true, woke: false, waitedMs: 0, device: null });
  assert.equal(h.pushes.length, 0);
});

test('nowhere to play: one silent push with the kit\'s id, then it waits for the phone and plays', async () => {
  const h = house({ phoneAfterPolls: 3 });
  const answer = await wakeAndPlay({ trackUri: 'spotify:track:abc' }, h.deps);
  assert.equal(answer.ok, true);
  assert.equal(answer.ok && answer.woke, true);
  assert.equal(answer.ok && answer.device, 'pixel 9 pro');
  assert.equal(answer.waitedMs, 3 * WAKE_POLL_MS);
  assert.deepEqual(h.pushes, [{ kind: SPOTIFY_WAKE_KIND, clientId: 'cid', redirectUri: 'aerie://spotify' }]);
  assert.equal(h.counts().plays, 2);
});

test('no client id: still pushes, empty, so the phone uses the media key', async () => {
  const h = house({ phoneAfterPolls: 1, connectFails: true });
  const answer = await wakeAndPlay({}, h.deps);
  assert.equal(answer.ok, true);
  assert.deepEqual(h.pushes, [{ kind: SPOTIFY_WAKE_KIND, clientId: '', redirectUri: '' }]);
});

test('the phone never shows up: a plain no after the wait, and no second play', async () => {
  const h = house();
  const answer = await wakeAndPlay({}, h.deps);
  assert.equal(answer.ok, false);
  assert.equal(!answer.ok && answer.reason, 'device');
  assert.ok(answer.waitedMs >= WAKE_WAIT_MS);
  assert.equal(h.counts().plays, 1);
});

test('the push reaches no phone: said plainly, nothing waited for', async () => {
  const h = house({ pushTaken: 0 });
  const answer = await wakeAndPlay({}, h.deps);
  assert.equal(answer.ok, false);
  assert.equal(!answer.ok && answer.reason, 'push');
  assert.equal(h.counts().polls, 0);
});

test('any other refusal is answered as it is, and never pushed', async () => {
  const h = house({ firstPlay: () => { throw new SpotifyError('signin', 'Spotify needs signing in again.'); } });
  const answer = await wakeAndPlay({}, h.deps);
  assert.equal(answer.ok, false);
  assert.equal(!answer.ok && answer.reason, 'signin');
  assert.equal(h.pushes.length, 0);
});
