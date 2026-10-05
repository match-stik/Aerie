// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import { usedFromRemaining } from './antigravity-meter.js';

test('A FULL BAR MUST MEAN THE SAME THING IN ALL THREE CARDS', () => {
  // agy says 100% remaining when nothing has been spent. Rendered raw that is a
  // full bar, which in the two cards above it means the quota is used up.
  assert.equal(usedFromRemaining(100), 0, 'untouched quota reads as 0% used');
  assert.equal(usedFromRemaining(0), 100, 'exhausted quota reads as 100% used');
});

test('a real reading converts without floating-point litter', () => {
  // 100 - 99.97 is 0.030000000000001137 in binary floating point, which is what
  // made the component and its first test disagree.
  assert.equal(usedFromRemaining(99.97), 0.03);
  assert.equal(usedFromRemaining(99.79), 0.21);
});

test('a nonsense percent is clamped rather than drawn off the end of the bar', () => {
  assert.equal(usedFromRemaining(140), 0);
  assert.equal(usedFromRemaining(-40), 100);
});
