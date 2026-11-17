// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { promptNames, swapPromptName, swapOnToggle } from './studio-name-swap.ts';

const words = "Ash on the porch, Ash's scarf in the wind, holding Brandy's cat.";

test('a name is a whole word, possessive included, never part of another name', () => {
  assert.equal(promptNames(words, 'Ash'), true);
  assert.equal(promptNames('Ashley waves', 'Ash'), false);
  assert.equal(swapPromptName(words, 'Ash', 'Rowan'), "Rowan on the porch, Rowan's scarf in the wind, holding Brandy's cat.");
});

test('one person off, then another on, swaps the name in the words', () => {
  let s = swapOnToggle(words, {}, 'Ash', false);
  assert.equal(s.prompt, words);
  s = swapOnToggle(s.prompt, s.pending, 'Rowan', true);
  assert.match(s.prompt, /^Rowan on the porch, Rowan's scarf/);
  assert.deepEqual(s.pending, {});
});

test('the other order swaps too: the new person on, then the old one off', () => {
  let s = swapOnToggle(words, {}, 'Rowan', true);
  s = swapOnToggle(s.prompt, s.pending, 'Ash', false);
  assert.match(s.prompt, /^Rowan on the porch/);
});

test('adding a second person leaves the first one named', () => {
  const s = swapOnToggle(words, {}, 'Rowan', true);
  assert.equal(s.prompt, words);
  const t = swapOnToggle(s.prompt, s.pending, 'Juniper', true);
  assert.equal(t.prompt, words);
});

test('unpicking somebody the words never named changes nothing', () => {
  const s = swapOnToggle(words, {}, 'Juniper', false);
  assert.equal(s.prompt, words);
  assert.deepEqual(s.pending, {});
});
