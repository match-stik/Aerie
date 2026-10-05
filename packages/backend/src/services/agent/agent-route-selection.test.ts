// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import { effectiveAgentProvider, resolveCompatibleAgentRoute } from './agent-route-selection.js';

test('a Claude wake cannot be handed to the Codex warm lane', () => {
  assert.deepEqual(resolveCompatibleAgentRoute('claude-fable-5', 'codex-cli'), {
    routing: 'cli',
    corrected: true,
    reason: 'Claude model claude-fable-5 cannot run in the Codex CLI lane',
  });
});

test('a Codex wake cannot be handed to a Claude lane', () => {
  assert.equal(resolveCompatibleAgentRoute('gpt-5.6-sol', 'cli').routing, 'codex-cli');
  assert.equal(resolveCompatibleAgentRoute('gpt-5.6-luna', 'sdk').routing, 'codex-cli');
});

test('a known Codex model on auto keeps the interactive companion contracts', () => {
  assert.deepEqual(resolveCompatibleAgentRoute('gpt-5.6-sol', 'auto'), {
    routing: 'codex-cli',
    corrected: true,
    reason: 'Codex model gpt-5.6-sol uses the warm Codex CLI lane for companion turns',
  });
});

test('matching warm routes and provider routes are left alone', () => {
  assert.deepEqual(resolveCompatibleAgentRoute('claude-fable-5', 'cli'), {
    routing: 'cli',
    corrected: false,
  });
  assert.deepEqual(resolveCompatibleAgentRoute('gpt-5.6-terra', 'codex-cli'), {
    routing: 'codex-cli',
    corrected: false,
  });
  assert.deepEqual(resolveCompatibleAgentRoute('gpt-5.6-terra', 'api'), {
    routing: 'api',
    corrected: false,
  });
  assert.deepEqual(resolveCompatibleAgentRoute('openrouter/example/model', 'auto'), {
    routing: 'auto',
    corrected: false,
  });
});

test('warm routes name their own provider instead of inheriting the house-wide API preference', () => {
  assert.equal(effectiveAgentProvider('gpt-5.6-sol', 'codex-cli', 'anthropic'), 'codex');
  assert.equal(effectiveAgentProvider('claude-fable-5', 'cli', 'codex'), 'anthropic');
  assert.equal(effectiveAgentProvider('future-codex-extra', 'codex-cli', 'openrouter'), 'codex');
  assert.equal(effectiveAgentProvider('future-claude-extra', 'cli', 'openrouter'), 'anthropic');
});

test('auto derives known model families while explicit API routing preserves its configured provider', () => {
  assert.equal(effectiveAgentProvider('claude-fable-5', 'auto', 'codex'), 'anthropic');
  assert.equal(effectiveAgentProvider('gpt-5.6-sol', 'auto', 'anthropic'), 'codex');
  assert.equal(effectiveAgentProvider('openrouter/example/model', 'auto', 'openrouter'), 'openrouter');
  assert.equal(effectiveAgentProvider('claude-fable-5', 'api', 'openrouter'), 'openrouter');
});
