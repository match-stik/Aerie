// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isCurrentModelRow, providerForRouting } from './model-row.js';

test('a Codex model listed on both lanes is ticked only on the warm lane it runs on', () => {
  const sdk = { id: 'gpt-6.2-sol', provider: 'codex' };
  const warm = { id: 'gpt-6.2-sol', provider: 'codex-cli' };
  assert.equal(isCurrentModelRow(warm, 'gpt-6.2-sol', 'codex-cli'), true);
  assert.equal(isCurrentModelRow(sdk, 'gpt-6.2-sol', 'codex-cli'), false);
});

test('a Claude model is ticked on the lane routing names, SDK or warm', () => {
  const sdk = { id: 'claude-opus-5-5', provider: 'anthropic' };
  const warm = { id: 'claude-opus-5-5', provider: 'claude-cli' };
  assert.equal(isCurrentModelRow(warm, 'claude-opus-5-5', 'cli'), true);
  assert.equal(isCurrentModelRow(sdk, 'claude-opus-5-5', 'cli'), false);
  assert.equal(isCurrentModelRow(sdk, 'claude-opus-5-5', 'sdk'), true);
  assert.equal(isCurrentModelRow(warm, 'claude-opus-5-5', 'sdk'), false);
});

test('routing that pins no lane matches by id alone, and a different id never matches', () => {
  assert.equal(providerForRouting('auto'), '');
  assert.equal(isCurrentModelRow({ id: 'llama', provider: 'ollama' }, 'llama', 'auto'), true);
  assert.equal(isCurrentModelRow({ id: 'other', provider: 'claude-cli' }, 'llama', 'cli'), false);
});
