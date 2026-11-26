// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The Claude picker reads the signed-in account's models (Nov 26 2026) and never
// refreshes the login to do it.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { loadConfig } = await import('../config.js');
loadConfig(join(mkdtempSync(join(tmpdir(), 'claude-models-')), 'none.yaml'));
const { initDb } = await import('./db/init.js');
const { setConfig } = await import('./db/config.js');
const { claudeModelsFromApi, discoverClaudeModels, resetClaudeModelMemo } = await import('./claude-model-discovery.js');
initDb(':memory:');

const reply = {
  data: [
    { type: 'model', id: 'claude-fable-5-2', display_name: 'Claude Fable 5.2', max_input_tokens: 1000000 },
    { type: 'model', id: 'claude-opus-4-5-20251101', display_name: 'Claude Opus 4.5', max_input_tokens: 200000 },
    { type: 'model', id: 'not-a-claude', display_name: 'Other' },
  ],
};
const okFetch = (async () => ({ ok: true, json: async () => reply })) as unknown as typeof fetch;
const token = { accessToken: 'tok', expiresAt: Date.now() + 3600_000 };

test('the reply becomes picker rows with their names and windows', () => {
  const rows = claudeModelsFromApi(reply);
  assert.deepEqual(rows.map(r => [r.id, r.name, r.context_length]), [
    ['claude-fable-5-2', 'Claude Fable 5.2', 1000000],
    ['claude-opus-4-5-20251101', 'Claude Opus 4.5', 200000],
  ]);
  assert.deepEqual(claudeModelsFromApi({}), []);
});

test('an expired login is never used: no call goes out and the last good list comes back', async () => {
  resetClaudeModelMemo();
  setConfig('models.claude_account_cache', JSON.stringify([{ id: 'claude-kept', name: 'Kept', provider: 'anthropic', tier: 'included' }]));
  let called = false;
  const spy = (async () => { called = true; return { ok: true, json: async () => reply }; }) as unknown as typeof fetch;
  const got = await discoverClaudeModels(spy, Date.now(), { accessToken: 'tok', expiresAt: Date.now() - 1000 });
  assert.equal(called, false);
  assert.deepEqual(got.map(m => m.id), ['claude-kept']);
});

test('a good read is kept, and a failed one hands back the last good list', async () => {
  resetClaudeModelMemo();
  setConfig('models.claude_account_cache', '');
  const first = await discoverClaudeModels(okFetch, Date.now(), token);
  assert.deepEqual(first.map(m => m.id), ['claude-fable-5-2', 'claude-opus-4-5-20251101']);
  resetClaudeModelMemo();
  const failing = (async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;
  const after = await discoverClaudeModels(failing, Date.now(), token);
  assert.deepEqual(after.map(m => m.id), ['claude-fable-5-2', 'claude-opus-4-5-20251101']);
});
