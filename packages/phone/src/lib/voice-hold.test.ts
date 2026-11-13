// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keepHoldingForMore, CONTINUATION_MAX_MS } from './voice-hold';

test('the call keeps holding while the turn is still running, minutes in', () => {
  assert.equal(keepHoldingForMore({ presence: 'active' }, 5 * 60_000), true);
  assert.equal(keepHoldingForMore({ presence: 'dormant', streamingMessageId: 'm1' }, 60_000), true);
});

test('it lets go once the turn has ended', () => {
  assert.equal(keepHoldingForMore({ presence: 'dormant', streamingMessageId: null }, 20_000), false);
});

test('and at the cap even if the lane never goes quiet', () => {
  assert.equal(keepHoldingForMore({ presence: 'active' }, CONTINUATION_MAX_MS), false);
});
