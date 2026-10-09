// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// The Usage cards' numbers in the largest unit that keeps them short.

import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenCount } from './token-count.js';

test('billions and trillions get their own units', () => {
  assert.equal(tokenCount(59_292_638_077), '59.29B');
  assert.equal(tokenCount(58_444_806_655), '58.44B');
  assert.equal(tokenCount(1_234_567_890_123), '1.23T');
});

test('the smaller units read as they always did', () => {
  assert.equal(tokenCount(127_366_160), '127.37M');
  assert.equal(tokenCount(12_345), '12.3K');
  assert.equal(tokenCount(999), '999');
  assert.equal(tokenCount(0), '0');
});

test('a number that rounds up to a thousand of one unit is shown in the next', () => {
  assert.equal(tokenCount(999_999_999), '1.00B');
  assert.equal(tokenCount(999_999), '1.00M');
  assert.equal(tokenCount(994_000_000), '994.00M');
});
