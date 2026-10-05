// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSilenceCheckModel } from './silence-check.js';
import type { AerieConfig } from '../config.js';

function configWith(agent: Partial<AerieConfig['agent']>): AerieConfig {
  return { agent } as AerieConfig;
}

test('a Codex pulse model is used directly', () => {
  const config = configWith({ model_pulse: 'gpt-5.6-luna', archivist_provider: 'codex', archivist_model: 'gpt-5.6-terra' });
  assert.equal(resolveSilenceCheckModel(config), 'gpt-5.6-luna');
});

test('a Claude pulse model never reaches the failsafe — the Archivist Codex model rides instead', () => {
  const config = configWith({ model_pulse: 'claude-haiku-4-5-20251001', archivist_provider: 'codex', archivist_model: 'gpt-5.6-terra' });
  assert.equal(resolveSilenceCheckModel(config), 'gpt-5.6-terra');
});

test('with no Codex model configured anywhere, the fallback still stays on the Codex lane', () => {
  const config = configWith({ model_pulse: 'claude-haiku-4-5-20251001', archivist_provider: 'ollama', archivist_model: 'deepseek-v4-pro' });
  assert.equal(resolveSilenceCheckModel(config), 'gpt-5.6-terra');
});
