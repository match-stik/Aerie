// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The same reaction from several people is drawn once with a count, in the
// order each first arrived.

import test from 'node:test';
import assert from 'node:assert/strict';
import { groupReactions } from './reaction-groups.js';

test('repeats fold into one with a count, first arrival keeps its place', () => {
  // A real pill from Oct 25 2026: two emotes each used twice, one used once.
  const party = '<a:party:123456789012345678>';
  const omg = '<:omg:323456789012345678>';
  const pound = '<a:wave:223456789012345678>';
  assert.deepEqual(groupReactions([party, omg, omg, party, pound]), [
    { emoji: party, count: 2 },
    { emoji: omg, count: 2 },
    { emoji: pound, count: 1 },
  ]);
  assert.deepEqual(groupReactions(['🧡', '🪿', '🫦']).map((g) => g.count), [1, 1, 1]);
  assert.deepEqual(groupReactions([]), []);
});
