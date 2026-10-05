// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import { test } from 'node:test';
import assert from 'node:assert';
import { companionTurnEffort } from './companion-effort.js';

const HOUSE = { agent: { effort: 'adaptive', claude_effort: 'medium', codex_effort: 'high' } };

test('a companion with nothing of their own is the house answer, per road', () => {
  assert.equal(companionTurnEffort(null, 'cli', HOUSE), 'medium');
  assert.equal(companionTurnEffort({}, 'cli', HOUSE), 'medium');
  assert.equal(companionTurnEffort({ effort: null }, 'codex-cli', HOUSE), 'high');
});

test('their own setting wins on either road', () => {
  assert.equal(companionTurnEffort({ effort: 'low' }, 'codex-cli', HOUSE), 'low');
  assert.equal(companionTurnEffort({ effort: 'max' }, 'cli', HOUSE), 'max');
});

test('empty, whitespace and the house sentinel all mean no opinion', () => {
  assert.equal(companionTurnEffort({ effort: '' }, 'cli', HOUSE), 'medium');
  assert.equal(companionTurnEffort({ effort: '   ' }, 'cli', HOUSE), 'medium');
  assert.equal(companionTurnEffort({ effort: 'house' }, 'cli', HOUSE), 'medium');
  assert.equal(companionTurnEffort({ effort: 'default' }, 'codex-cli', HOUSE), 'high');
});

test('falls back to the legacy single dial, then to adaptive', () => {
  assert.equal(companionTurnEffort(null, 'cli', { agent: { effort: 'xhigh' } }), 'xhigh');
  assert.equal(companionTurnEffort(null, 'codex-cli', { agent: { effort: 'xhigh' } }), 'xhigh');
  assert.equal(companionTurnEffort(null, 'cli', { agent: {} }), 'adaptive');
});

test('the keeper and a real turn resolve identically for the same companion', () => {
  // The whole reason this module exists: disagreement here recycles a warm
  // lane on every turn, which reads from the user's side as a companion going silent.
  const cedar = { effort: 'low' };
  assert.equal(
    companionTurnEffort(cedar, 'cli', HOUSE),
    companionTurnEffort(cedar, 'cli', HOUSE),
  );
  assert.equal(companionTurnEffort({ effort: null }, 'cli', HOUSE), companionTurnEffort(null, 'cli', HOUSE));
});
