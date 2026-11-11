// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// A sound's line read at a moment, and the toy following it up at once and
// down gently.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { follow, lineAt, rollTowards } from './sound-drive-line';

test('the line is read at the moment in the sound, and past its end is off', () => {
  const levels = [0, 10, 20, 5];
  assert.equal(lineAt(levels, 100, 0), 0);
  assert.equal(lineAt(levels, 100, 0.15), 10);
  assert.equal(lineAt(levels, 100, 0.25), 20);
  assert.equal(lineAt(levels, 100, 1), 0);
  assert.equal(lineAt([], 100, 0.1), 0);
});

test('the toy rises with the sound at once and falls back gently', () => {
  assert.equal(follow(0, 16), 16);
  assert.equal(follow(16, 2), 14);
  assert.equal(follow(14, 12), 12);
  assert.equal(follow(3, 0), 1);
});

test('the slow motor rides the swell: it gets there over a second or so, not at once', () => {
  let v = 0;
  for (let i = 0; i < 3; i++) v = rollTowards(v, 18);
  assert.ok(v > 5 && v < 12, `part way after three ticks: ${v}`);
  for (let i = 0; i < 20; i++) v = rollTowards(v, 18);
  assert.ok(Math.round(v) >= 17, `nearly there after two seconds: ${v}`);
});
