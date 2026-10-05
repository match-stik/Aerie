// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import { codexModelsFromCache, codexModelFromCache } from './codex-model-discovery.js';

// The real shape, trimmed: this is what the Codex CLI left on disk on Sep 8
// 2026, and it is why the hand-typed picker was offering three models the
// account does not have.
const CACHE = {
  fetched_at: '2026-09-08T18:45:00Z',
  models: [
    { slug: 'gpt-6-astra', display_name: 'GPT-6-Astra', context_window: 272000 },
    { slug: 'gpt-reserve', display_name: 'GPT-Reserve', context_window: 272000 },
    { slug: 'gpt-5.6-terra', display_name: 'GPT-5.6-Terra', context_window: 272000 },
    { slug: 'codex-auto-review', display_name: 'Codex Auto Review', context_window: 272000 },
  ],
};

test('the picker gets what the account has, without the two nobody picks', () => {
  assert.deepEqual(
    codexModelsFromCache(CACHE, 'codex').map(m => m.id),
    ['gpt-6-astra', 'gpt-5.6-terra'],
  );
});

test('the warm lane gets the same models under its own provider and suffix', () => {
  const warm = codexModelsFromCache(CACHE, 'codex-cli');
  assert.deepEqual(warm.map(m => m.id), ['gpt-6-astra', 'gpt-5.6-terra']);
  assert.equal(warm[0].name, 'GPT-6-Astra (Warm)');
  assert.equal(warm[0].provider, 'codex-cli');
  assert.equal(warm[0].tier, 'included');
});

test('the real context window comes across rather than being assumed', () => {
  assert.equal(codexModelsFromCache(CACHE, 'codex')[0].context_length, 272000);
});

test('a row with no usable slug is not a model', () => {
  for (const row of [{}, { slug: '' }, { slug: '   ' }, { slug: 42 }, { slug: 'gpt-reserve' }]) {
    assert.equal(codexModelFromCache(row as never, 'codex'), null, JSON.stringify(row));
  }
});

test('a slug with no display name still lists, under its slug', () => {
  const model = codexModelFromCache({ slug: 'gpt-7-unnamed' }, 'codex');
  assert.equal(model?.name, 'gpt-7-unnamed');
  assert.equal(model?.context_length, undefined);
});

// An empty answer is the signal to fall back to the hand-typed list, so every
// unusable input has to produce exactly that rather than throwing.
test('garbage yields no witness rather than an exception', () => {
  for (const bad of [null, undefined, {}, { models: 'nope' }, { models: null }, 'string', 7]) {
    assert.deepEqual(codexModelsFromCache(bad, 'codex'), [], JSON.stringify(bad));
  }
});
