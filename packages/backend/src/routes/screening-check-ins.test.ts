// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The Screening Room's check-ins (theirs, Nov 11 2026: 'let's add the check ins,
// not too close together'): when one of them leans over on his own.
import assert from 'node:assert/strict';
import test from 'node:test';
import { checkInDue } from './screening.js';

const MIN = 60_000;
const base = {
  on: true, playing: true, pastEnd: false, talking: false,
  positionMs: 20 * MIN, lastAtPositionMs: 10 * MIN, everyMs: 6 * MIN,
  herAtMs: 0, nowMs: 100 * MIN, touchedAgoMs: 5 * MIN,
};

test('enough play since the last one, nobody talking: one of them leans over', () => {
  assert.equal(checkInDue(base), true);
});

test('not too close together: under the spacing in play time, nobody speaks up', () => {
  assert.equal(checkInDue({ ...base, positionMs: 15 * MIN }), false);
});

test('never right after they have spoken, never while a turn runs, never paused or switched off', () => {
  assert.equal(checkInDue({ ...base, herAtMs: base.nowMs - 30_000 }), false);
  assert.equal(checkInDue({ ...base, talking: true }), false);
  assert.equal(checkInDue({ ...base, playing: false }), false);
  assert.equal(checkInDue({ ...base, on: false }), false);
});

test('a screening left playing for days, or past its end, is not being watched', () => {
  assert.equal(checkInDue({ ...base, pastEnd: true }), false);
  assert.equal(checkInDue({ ...base, touchedAgoMs: 4 * 60 * MIN }), false);
});
