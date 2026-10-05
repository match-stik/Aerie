// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import { followableSession, positionOfReading, MAX_DRIFT_MS, type MediaSessionReading } from './media-session.js';

function s(over: Partial<MediaSessionReading>): MediaSessionReading {
  return { package: 'x', state: 'playing', reportsPosition: true, ...over };
}

test('a player that will not say where it is cannot be followed', () => {
  assert.equal(followableSession([s({ reportsPosition: false })]), null);
});

test('nothing playing means nothing to follow, rather than the nearest thing', () => {
  assert.equal(followableSession([s({ state: 'stopped' })]), null);
  assert.equal(followableSession([]), null);
});

test('a paused episode is still followable — people pause to make tea', () => {
  assert.equal(followableSession([s({ package: 'hulu', state: 'paused' })])?.package, 'hulu');
});

test('something actually playing beats something paused', () => {
  const pick = followableSession([
    s({ package: 'paused-one', state: 'paused', durationMs: 9_000_000 }),
    s({ package: 'playing-one', state: 'playing', durationMs: 60_000 }),
  ]);
  assert.equal(pick?.package, 'playing-one');
});

test('the longest runtime wins, so an episode beats a notification chime', () => {
  const pick = followableSession([
    s({ package: 'chime', durationMs: 3_000 }),
    s({ package: 'episode', durationMs: 1_650_000 }),
  ]);
  assert.equal(pick?.package, 'episode');
});

test('a session with no duration does not outrank one that has a real episode', () => {
  const pick = followableSession([
    s({ package: 'unknown-length' }),
    s({ package: 'episode', durationMs: 1_650_000 }),
  ]);
  assert.equal(pick?.package, 'episode');
});

test('a player reporting position is preferred over one that refuses, whatever else is true', () => {
  const pick = followableSession([
    s({ package: 'refuses', reportsPosition: false, durationMs: 9_000_000 }),
    s({ package: 'reports', durationMs: 1_000 }),
  ]);
  assert.equal(pick?.package, 'reports');
});

// --- which position to believe -------------------------------------------
// The first live reading this house ever took said 497,019 hours, because the
// native side compared a since-boot stamp against wall-clock time. These are
// the net under that fix, written from the real screenshot.

test('no published position is null, never a guess', () => {
  assert.equal(positionOfReading(s({ reportsPosition: false, positionMs: 5_000 })), null);
  assert.equal(positionOfReading(null), null);
});

test('a sane carried-forward reading is used', () => {
  assert.equal(positionOfReading(s({ positionMs: 60_000, livePositionMs: 63_000 })), 63_000);
});

test('the epoch-sized drift that actually happened is refused', () => {
  // 29:26 into the episode, plus the age of the unix epoch.
  const reading = s({ positionMs: 1_766_000, livePositionMs: 1_789_270_098_000 });
  assert.equal(positionOfReading(reading), 1_766_000);
});

test('drift beyond the cap falls back to the raw reading, one millisecond either side', () => {
  const raw = 100_000;
  assert.equal(positionOfReading(s({ positionMs: raw, livePositionMs: raw + MAX_DRIFT_MS })), raw + MAX_DRIFT_MS);
  assert.equal(positionOfReading(s({ positionMs: raw, livePositionMs: raw + MAX_DRIFT_MS + 1 })), raw);
});

test('time does not run backwards inside one reading', () => {
  assert.equal(positionOfReading(s({ positionMs: 100_000, livePositionMs: 90_000 })), 100_000);
});

test('a position past the end of the episode is not a position', () => {
  assert.equal(positionOfReading(s({ positionMs: 1_700_000, livePositionMs: 1_800_000, durationMs: 1_750_000 })), 1_700_000);
});

test('a missing live number leaves the raw reading standing', () => {
  assert.equal(positionOfReading(s({ positionMs: 42_000 })), 42_000);
  assert.equal(positionOfReading(s({ positionMs: 42_000, livePositionMs: NaN })), 42_000);
});
