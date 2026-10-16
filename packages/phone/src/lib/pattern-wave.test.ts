// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { levelAt } from './pattern-wave.js';

const track = { levels: [0, 10, 20], max: 20, color: '#ff5a14' };

test('a level lands on its sample exactly and eases between samples', () => {
  assert.equal(levelAt(track, 100, 100), 10);
  assert.equal(levelAt(track, 100, 150), 15); // halfway, where the ease is symmetric
  assert.ok(levelAt(track, 100, 110) < 11, 'leaves a sample slowly');
});

test('before the start and after the end, the line holds its first and last level', () => {
  assert.equal(levelAt(track, 100, -500), 0);
  assert.equal(levelAt(track, 100, 9999), 20);
  assert.equal(levelAt({ ...track, levels: [] }, 100, 50), 0);
});
