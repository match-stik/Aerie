// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { requiredSilenceMs } from './turn-silence.js';

const opts = { baseMs: 1750, longTurnAfterMs: 10_000, longTurnSilenceMs: 3000, rampMs: 20_000 };

test('a short turn ends on the base silence', () => {
  assert.equal(requiredSilenceMs(2_000, opts), 1750);
  assert.equal(requiredSilenceMs(10_000, opts), 1750);
});

test('a ramble waits longer, climbing to the ceiling', () => {
  assert.equal(requiredSilenceMs(20_000, opts), 2375);
  assert.equal(requiredSilenceMs(30_000, opts), 3000);
  assert.equal(requiredSilenceMs(80_000, opts), 3000);
});

test('no ceiling, or a ceiling at or under the base, keeps the base', () => {
  assert.equal(requiredSilenceMs(60_000, { baseMs: 1750 }), 1750);
  assert.equal(requiredSilenceMs(60_000, { baseMs: 1750, longTurnSilenceMs: 1500 }), 1750);
});
