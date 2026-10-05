// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseElevenLabsSubscription } from './elevenlabs-usage.js';

test('parses a normal subscription payload', () => {
  const usage = parseElevenLabsSubscription({
    tier: 'starter',
    character_count: 12_345,
    character_limit: 30_000,
    next_character_count_reset_unix: 1_754_000_000,
  });
  assert.equal(usage.tier, 'starter');
  assert.equal(usage.characterCount, 12_345);
  assert.equal(usage.characterLimit, 30_000);
  assert.equal(usage.remaining, 17_655);
  assert.equal(usage.usedPercent, 41.2);
  assert.equal(usage.nextResetAt, new Date(1_754_000_000 * 1000).toISOString());
});

test('missing fields degrade safely instead of NaN', () => {
  const usage = parseElevenLabsSubscription({});
  assert.equal(usage.tier, 'unknown');
  assert.equal(usage.characterCount, 0);
  assert.equal(usage.characterLimit, 0);
  assert.equal(usage.remaining, 0);
  assert.equal(usage.usedPercent, 0);
  assert.equal(usage.nextResetAt, null);
});

test('overage never reports negative remaining and caps percent', () => {
  const usage = parseElevenLabsSubscription({
    character_count: 31_000,
    character_limit: 30_000,
  });
  assert.equal(usage.remaining, 0);
  assert.equal(usage.usedPercent, 100);
});
