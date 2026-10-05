// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRuntime } from './index.js';

test('a Claude wake uses Claude CLI even when the interactive provider is Codex', async () => {
  const runtime = await createRuntime('cli', 'claude-fable-5', undefined, {
    provider: 'codex',
    cliOptions: { sessionKey: 'route-guard-test' },
  });

  assert.equal(runtime.name, 'interactive-cli');
  runtime.dispose?.();
});

test('a Codex model is still rejected from the Claude CLI lane', async () => {
  await assert.rejects(
    createRuntime('cli', 'gpt-5.6-sol', undefined, { provider: 'codex' }),
    /cannot run in the Claude CLI lane/,
  );
});
