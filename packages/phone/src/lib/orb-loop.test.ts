// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// A looped orb plays back what the finger did, in order, and goes round again.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loopSample } from './orb-loop';

const s = (at: number, level: number) => ({ at, x: 0, y: 0, level });

test('a loop holds each level until the finger changed it, and goes round', () => {
  const samples = [s(100, 4), s(300, 10), s(700, 16), s(1100, 16)];
  const length = 1000;
  const start = 5000;
  assert.equal(loopSample(samples, start, length, 5000).level, 4);
  assert.equal(loopSample(samples, start, length, 5150).level, 4);
  assert.equal(loopSample(samples, start, length, 5250).level, 10);
  assert.equal(loopSample(samples, start, length, 5650).level, 16);
  assert.equal(loopSample(samples, start, length, 6050).level, 4, 'back to the start after one length');
  assert.equal(loopSample(samples, start, length, 6250).level, 10);
});
