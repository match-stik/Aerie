// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import { ageOf, isStale, recordReading, STALE_AFTER_MS, type MediaSessionReading } from './media-session.js';

const reading = (over: Partial<MediaSessionReading> = {}): MediaSessionReading => ({
  id: 'r', package: 'com.hulu.plus', state: 'playing', reportsPosition: true,
  positionMs: 60_000, livePositionMs: 63_000, durationMs: null, speed: 1,
  title: null, receivedAtMs: 1_000_000, ...over,
});

test('a phone with nothing playing is not a reading, and never buries the last real one', () => {
  assert.equal(recordReading({}), null);
  assert.equal(recordReading({ package: '' }), null);
  assert.equal(recordReading({ package: '   ' }), null);
  assert.equal(recordReading({ state: 'playing', positionMs: 5 }), null);
});

test('age never runs backwards, even when the clocks disagree', () => {
  assert.equal(ageOf(reading(), 1_000_030), 30);
  assert.equal(ageOf(reading(), 999_000), 0);
});

test('staleness turns over exactly at the cap, one millisecond either side', () => {
  const at = (ms: number) => isStale(reading(), 1_000_000 + ms);
  assert.equal(at(STALE_AFTER_MS), false);
  assert.equal(at(STALE_AFTER_MS + 1), true);
});

test('a fresh reading is not stale', () => {
  assert.equal(isStale(reading(), 1_000_500), false);
});
