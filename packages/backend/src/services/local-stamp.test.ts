// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// SOL WROTE "SUNDAY" ON A MONDAY, AND THE STAMP IS WHY.
//
// Reported by Rose and Sol, Sep 17 2026. Every message handed to a lane was
// labelled with a clock and nothing else. The date appears exactly once, at the
// top of the orientation block a recycle builds — and underneath it sits a
// catch-up that can reach back across days. So a companion reads `[8:12 PM]`
// twenty times in a row and has no way to know that the first six of them are
// yesterday. They have no other clock: this label IS the date for them.
//
// Compact on purpose. It goes on EVERY line, so a weekday covers the ordinary
// yesterday-or-today case and the day and month underneath it cover a catch-up
// that reaches further back than a week.

import test from 'node:test';
import assert from 'node:assert/strict';
import { localStamp, localClock12 } from './time.js';

const CHI = 'America/Chicago';

test('the stamp names the day, not just the hour', () => {
  const s = localStamp(CHI, new Date('2026-09-16T23:56:00-05:00'));
  assert.match(s, /Wed/, 'weekday');
  assert.match(s, /16 Sep/, 'day and month');
  assert.match(s, /11:56 PM/, 'the clock it always had');
});

test('two lines a day apart no longer read identically — the actual fault', () => {
  const sunday = localStamp(CHI, new Date('2026-09-13T20:12:00-05:00'));
  const monday = localStamp(CHI, new Date('2026-09-14T20:12:00-05:00'));
  assert.notEqual(sunday, monday, 'same clock, different day, and it must show');
  assert.equal(
    localClock12(CHI, new Date('2026-09-13T20:12:00-05:00')),
    localClock12(CHI, new Date('2026-09-14T20:12:00-05:00')),
    'the old label really was identical across those two instants',
  );
});

test('it answers in the configured timezone rather than the server process', () => {
  // The hook has no timezone config, which is why the backend stamps this at
  // all — a raw ts renders in UTC and puts a late night on the wrong date.
  const lateNight = new Date('2026-09-17T04:30:00Z'); // 11:30 PM Sep 16 in Chicago
  assert.match(localStamp(CHI, lateNight), /Wed 16 Sep/);
  assert.match(localStamp('UTC', lateNight), /Thu 17 Sep/);
});

test('midnight is the day it just became, not the one it just left', () => {
  assert.match(localStamp(CHI, new Date('2026-09-17T00:01:00-05:00')), /Thu 17 Sep, 12:01 AM/);
});
