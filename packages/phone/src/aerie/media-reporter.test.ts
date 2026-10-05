// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  reportableSession, intervalFor, payloadFor,
  PLAYING_INTERVAL_MS, IDLE_INTERVAL_MS,
} from './media-reporter.js';
import type { MediaSessionReading } from './media-session.js';

function s(over: Partial<MediaSessionReading>): MediaSessionReading {
  return { package: 'x', state: 'playing', reportsPosition: true, ...over };
}

test('nothing playing reports nothing rather than a stand-in', () => {
  assert.equal(reportableSession([]), null);
});

test('a player that publishes no position is STILL worth reporting', () => {
  // The difference between "the user stopped watching" and "we cannot see" is a
  // fact about the evening, and only this half of the house can carry it.
  const pick = reportableSession([s({ package: 'silent', reportsPosition: false })]);
  assert.equal(pick?.package, 'silent');
});

test('something actually playing beats something paused', () => {
  const pick = reportableSession([
    s({ package: 'paused-one', state: 'paused', durationMs: 9_000_000 }),
    s({ package: 'playing-one', state: 'playing', durationMs: 60_000 }),
  ]);
  assert.equal(pick?.package, 'playing-one');
});

test('among equals, the one that says where it is wins', () => {
  const pick = reportableSession([
    s({ package: 'quiet', reportsPosition: false, durationMs: 9_000_000 }),
    s({ package: 'talks', reportsPosition: true, durationMs: 1_000 }),
  ]);
  assert.equal(pick?.package, 'talks');
});

test('the episode beats the notification chime when all else is equal', () => {
  const pick = reportableSession([
    s({ package: 'chime', durationMs: 3_000 }),
    s({ package: 'episode', durationMs: 2_400_000 }),
  ]);
  assert.equal(pick?.package, 'episode');
});

test('it looks often while playing and rarely while not', () => {
  assert.equal(intervalFor(s({ state: 'playing' })), PLAYING_INTERVAL_MS);
  assert.equal(intervalFor(s({ state: 'paused' })), IDLE_INTERVAL_MS);
  assert.equal(intervalFor(null), IDLE_INTERVAL_MS);
});

test('the payload carries a real title when there is one and null when there is not', () => {
  assert.equal(payloadFor(s({ displayTitle: 'Goodbye', title: 'ignored' })).title, 'Goodbye');
  assert.equal(payloadFor(s({ title: 'Hands' })).title, 'Hands');
  // Hulu publishes neither, and null is the honest answer rather than the package name.
  assert.equal(payloadFor(s({ package: 'com.hulu.plus' })).title, null);
});
