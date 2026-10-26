// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The owner status rides with their turns as one line, and only when the owner has one.

import test from 'node:test';
import assert from 'node:assert/strict';
import { formatOwnerStatus } from './owner-status.js';

test('the owner status reads as their own words with the time the owner set it', () => {
  const line = formatOwnerStatus({ text: 'At work', icon: '📦', by: 'owner', setAt: '2026-10-26T21:30:00.000Z', until: null }, 'America/Chicago');
  assert.match(line, /^\[The owner status, in their own words, set Mon 26 Oct, 4:30 PM: 📦 At work\./);
  assert.ok(line.endsWith(']\n\n'));
});

test('no status, no line', () => {
  assert.equal(formatOwnerStatus(null, 'America/Chicago'), '');
  assert.equal(formatOwnerStatus({ text: '  ', icon: null, by: 'owner', setAt: '', until: null }, 'America/Chicago'), '');
});

test('a status with no icon or stamp still reads', () => {
  assert.equal(
    formatOwnerStatus({ text: 'Driving', icon: null, by: 'owner', setAt: '', until: null }, 'America/Chicago'),
    '[The owner status, in their own words: Driving. The owner changes it themselves; it does not fade.]\n\n',
  );
});
