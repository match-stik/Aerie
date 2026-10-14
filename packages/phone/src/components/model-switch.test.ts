// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { test } from 'node:test';
import assert from 'node:assert';
import { isModelSwitch } from './model-switch.js';

test('a different model is a switch', () => {
  assert.equal(isModelSwitch('gpt-6-astra', 'claude-opus-5'), true);
});

test('the same model read again is not', () => {
  assert.equal(isModelSwitch('claude-opus-5', 'claude-opus-5'), false);
});

test('the first read after a page load is not a switch', () => {
  // Wiping here would clear a live rate-limit banner on every refresh.
  assert.equal(isModelSwitch('', 'claude-opus-5'), false);
});

test('a config read that comes back empty is not a switch', () => {
  assert.equal(isModelSwitch('claude-opus-5', ''), false);
});
