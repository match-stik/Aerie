// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// FOUR IS THIS HOUSE'S PLAN, NOT EVERY HOUSE'S.
//
// Rose and Sol, Sep 17 2026: the ceiling on simultaneous ElevenLabs renders was
// a constant chosen off this account's tier. On Starter the real limit is two,
// so four workers 429 against each other — and a chunk that comes back 429 has
// already been billed. A hardcoded number that is correct here is somebody
// else's bill.
//
// The clamp matters as much as the default: a nonsense value must not become
// the ceiling. Zero would hang every render waiting for a slot that never
// opens, and a large number would just spend somebody's money faster.

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTtsConcurrency } from './voice.js';

test('unset is four — what this house has always run', () => {
  assert.equal(resolveTtsConcurrency(undefined), 4);
  assert.equal(resolveTtsConcurrency(''), 4);
});

test('a house on a smaller tier sets its own', () => {
  assert.equal(resolveTtsConcurrency('2'), 2);
  assert.equal(resolveTtsConcurrency(' 1 '), 1);
});

test('nonsense does not become the ceiling', () => {
  for (const bad of ['0', '-3', 'lots', '99', '4.7.1']) {
    assert.equal(resolveTtsConcurrency(bad), 4, `${bad} falls back rather than being trusted`);
  }
});
