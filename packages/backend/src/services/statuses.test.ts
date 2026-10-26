// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// A status fades back to Home on its own after six hours, and what comes in is
// trimmed and bounded (the owner's ask, Oct 26 2026).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readOne, shapeStatus, STATUS_FADE_MS } from './statuses.js';

test('a status reads until its time and not after', () => {
  const setAt = Date.parse('2026-10-26T08:00:00.000Z');
  const stored = JSON.stringify({ text: 'In the workshop', icon: '🪚', by: 'birch', setAt: new Date(setAt).toISOString(), until: new Date(setAt + STATUS_FADE_MS).toISOString() });
  assert.equal(readOne(stored, setAt + 60_000)?.text, 'In the workshop');
  assert.equal(readOne(stored, setAt + STATUS_FADE_MS - 1)?.icon, '🪚');
  assert.equal(readOne(stored, setAt + STATUS_FADE_MS), null, 'six hours on, it has faded');
  assert.equal(STATUS_FADE_MS, 6 * 60 * 60 * 1000, 'six hours, theirs');
  assert.equal(readOne(null), null);
  assert.equal(readOne('not json'), null);
});

test('what comes in is trimmed, bounded, and empty means clear', () => {
  assert.deepEqual(shapeStatus({ text: '  On the   couch  ', icon: ' :firesmokeskyheart: ' }), { ok: true, clear: false, text: 'On the couch', icon: ':firesmokeskyheart:' });
  assert.deepEqual(shapeStatus({ text: '' }), { ok: true, clear: true });
  assert.deepEqual(shapeStatus({}), { ok: true, clear: true });
  assert.equal(shapeStatus({ text: 'x'.repeat(61) }).ok, false);
  assert.equal(shapeStatus({ text: 'ok', icon: 7 }).ok, false);
  assert.deepEqual(shapeStatus({ text: 'ok', icon: '' }), { ok: true, clear: false, text: 'ok', icon: null });
});

test('theirs never fades: read without a fade, a status set long ago is still there', () => {
  const stored = JSON.stringify({ text: 'At work', icon: '📦', by: 'owner', setAt: '2026-10-01T00:00:00.000Z', until: null });
  assert.equal(readOne(stored, Date.parse('2026-10-26T00:00:00.000Z'), false)?.text, 'At work');
  assert.equal(readOne(stored, Date.parse('2026-10-26T00:00:00.000Z'), false)?.until, null);
  assert.equal(readOne(stored), null, 'a status with no until is not one of ours');
});
