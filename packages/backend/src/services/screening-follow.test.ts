// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import { followAction, MAX_ACTIONABLE_AGE_MS, type ScreeningView } from './screening-follow.js';
import type { MediaSessionReading } from './db/media-session.js';

const reading = (over: Partial<MediaSessionReading> = {}): MediaSessionReading => ({
  id: 'r', package: 'com.hulu.plus', state: 'paused', reportsPosition: true,
  positionMs: 633_000, livePositionMs: 633_000, durationMs: null, speed: 1,
  title: null, receivedAtMs: 0, ...over,
});
const screening = (over: Partial<ScreeningView> = {}): ScreeningView =>
  ({ status: 'playing', followPackage: 'com.hulu.plus', ...over });

test('a paused reading is the truth and becomes the anchor', () => {
  // Measured on a real phone: playing said 28:08, and the instant playback paused it
  // said 22:43. The pause is the only honest number the player publishes.
  const a = followAction(reading({ positionMs: 1_363_850 }), screening(), 1_000);
  assert.equal(a.kind, 'anchor');
  assert.equal(a.kind === 'anchor' && a.positionMs, 1_363_850);
});

test('a PLAYING reading never moves the position, because it counts adverts', () => {
  const a = followAction(reading({ state: 'playing' }), screening({ status: 'paused' }), 1_000);
  assert.equal(a.kind, 'resume', 'should start the clock');
  assert.ok(!('positionMs' in a), 'must not carry a position');
});

test('already running with the owner is left alone', () => {
  assert.equal(followAction(reading({ state: 'playing' }), screening({ status: 'playing' }), 1_000).kind, 'none');
});

test('ANOTHER APP IS A DIFFERENT EVENING — a song must never move the episode', () => {
  const a = followAction(reading({ package: 'com.spotify.music' }), screening(), 1_000);
  assert.equal(a.kind, 'none');
});

test('with nothing followed yet, the first reading is allowed to anchor', () => {
  const a = followAction(reading(), screening({ followPackage: null }), 1_000);
  assert.equal(a.kind, 'anchor');
});

test('a stale reading describes the past, not the present', () => {
  assert.equal(followAction(reading(), screening(), MAX_ACTIONABLE_AGE_MS).kind, 'anchor');
  assert.equal(followAction(reading(), screening(), MAX_ACTIONABLE_AGE_MS + 1).kind, 'none');
});

test('a player that will not say where it is changes nothing', () => {
  assert.equal(followAction(reading({ reportsPosition: false }), screening(), 1_000).kind, 'none');
  assert.equal(followAction(reading({ positionMs: -1 }), screening(), 1_000).kind, 'none');
});

test('nothing loaded means nothing to follow', () => {
  assert.equal(followAction(reading(), null, 1_000).kind, 'none');
  assert.equal(followAction(null, screening(), 1_000).kind, 'none');
});
