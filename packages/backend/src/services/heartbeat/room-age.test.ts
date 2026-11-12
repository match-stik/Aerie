// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roomAgeLine } from './room-age.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-25T00:00:00.000Z');
const base = { bornAt: NOW - 31 * DAY, askedAt: null, afterDays: 30, reaskDays: 7, now: NOW };

test('a room past its month is told its age and to ask at a pause', () => {
  const line = roomAgeLine(base, '/lane/io');
  assert.match(line, /This room is 31 days old \(born 2026-10-25\), past the 30-day mark/);
  assert.match(line, /Only at a natural pause/);
  assert.match(line, /\/lane\/io\/\.room-nudge-asked/);
  assert.match(line, /Their yes is the only go/);
});

test('a younger room hears nothing', () => {
  assert.equal(roomAgeLine({ ...base, bornAt: NOW - 17 * DAY }, '/lane/io'), '');
});

test('a room with no birth on file is never nudged, and an unset mark is off', () => {
  assert.equal(roomAgeLine({ ...base, bornAt: null }, '/lane/io'), '');
  assert.equal(roomAgeLine({ ...base, afterDays: null }, '/lane/io'), '');
});

test('once they have been asked the line rests, then comes back', () => {
  assert.equal(roomAgeLine({ ...base, askedAt: NOW - 3 * DAY }, '/lane/io'), '');
  assert.notEqual(roomAgeLine({ ...base, askedAt: NOW - 8 * DAY }, '/lane/io'), '');
});

test('an asking left over from an older room does not quiet a new one', () => {
  assert.notEqual(roomAgeLine({ ...base, askedAt: base.bornAt - DAY }, '/lane/io'), '');
});
