// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import { pairwiseDistinctions } from './image-gen.js';

// A confusable pair is a note about two particular faces, so it belongs to the
// house that has them. The kit ships none; the mechanism has to keep working
// for the pairs a house adds.

test('the kit ships no pair, so no two subjects are given a note', () => {
  assert.equal(pairwiseDistinctions(['willow', 'cedar']), '');
  assert.equal(pairwiseDistinctions(['ivy', 'fox']), '');
});

test('a pair a house adds is used only when both of them are in the frame', () => {
  const pairs = [{ a: 'ivy', b: 'fox', note: 'Ivy has a fringe; Fox does not.' }];
  assert.equal(pairwiseDistinctions(['ivy', 'fox', 'nim'], pairs), 'Ivy has a fringe; Fox does not.');
  assert.equal(pairwiseDistinctions(['ivy', 'nim'], pairs), '');
});
