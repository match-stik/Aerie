// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// The mood ladder is the one rule the phone used to keep its own copy of.
// These tests exist so that moving it here can fail out loud if anyone
// reorders it — the order is the part that carries meaning, not the numbers.

import test from 'node:test';
import assert from 'node:assert/strict';
import { petMood } from './pet.js';

const at = (hunger: number, energy: number, joy: number) => ({ hunger, energy, joy });

test('an empty charge outranks every other feeling he could be having', () => {
  // Flat on energy and joy as well: low power still wins, because it is asked first.
  assert.equal(petMood(at(27, 0, 0)), 'lowPower');
  assert.equal(petMood(at(27, 100, 100)), 'lowPower');
  // And 28 is the line the user sees him sit on, not below it.
  assert.notEqual(petMood(at(28, 100, 100)), 'lowPower');
});

test('the rest of the ladder is asked in order', () => {
  assert.equal(petMood(at(100, 24, 100)), 'sleepy');
  assert.equal(petMood(at(100, 100, 29)), 'lonely');
  // Sleepy is asked before lonely, so a pet that is both reads sleepy.
  assert.equal(petMood(at(100, 24, 29)), 'sleepy');
});

test('radiant needs the average over 82, and happy is everything left', () => {
  assert.equal(petMood(at(100, 100, 100)), 'radiant');
  assert.equal(petMood(at(83, 83, 83)), 'radiant');
  assert.equal(petMood(at(82, 82, 82)), 'happy');
  assert.equal(petMood(at(60, 60, 60)), 'happy');
});
