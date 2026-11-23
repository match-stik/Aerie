// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitByLoad, type WallLoad } from './memory-blocks.js';

const wall = (label: string, n: number) => ({ scope: 'shared', label, content: 'x'.repeat(n) });

test('an untouched dial loads every wall', () => {
  const blocks = [wall('human', 10), wall('lore', 20)];
  const { loaded, skipped } = splitByLoad(blocks, () => 'always', null);
  assert.deepEqual(loaded.map((b) => b.label), ['human', 'lore']);
  assert.equal(skipped.length, 0);
});

test('a search-only wall is never loaded, budget or not', () => {
  const blocks = [wall('human', 10), wall('lore', 20)];
  const mode = (b: { label: string }): WallLoad => (b.label === 'lore' ? 'search' : 'always');
  assert.deepEqual(splitByLoad(blocks, mode, null).skipped.map((b) => b.label), ['lore']);
  assert.deepEqual(splitByLoad(blocks, mode, 1_000_000).skipped.map((b) => b.label), ['lore']);
});

test('room walls load in order while the budget holds, counting the always walls first', () => {
  const blocks = [wall('a', 50), wall('b', 30), wall('c', 30), wall('d', 10)];
  const mode = (b: { label: string }): WallLoad => (b.label === 'a' ? 'always' : 'room');
  const { loaded, skipped } = splitByLoad(blocks, mode, 95);
  assert.deepEqual(loaded.map((b) => b.label), ['a', 'b', 'd']);
  assert.deepEqual(skipped.map((b) => b.label), ['c']);
});

test('room walls with no budget load like always', () => {
  const blocks = [wall('a', 50), wall('b', 30)];
  assert.equal(splitByLoad(blocks, () => 'room', null).loaded.length, 2);
});
