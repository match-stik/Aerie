// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { modelLabel } from './model-label.ts';

test('the point release survives', () => {
  assert.equal(modelLabel('claude-opus-5-5'), 'Claude Opus 5.5');
  assert.equal(modelLabel('claude-fable-5-1'), 'Claude Fable 5.1');
  assert.equal(modelLabel('claude-opus-5'), 'Claude Opus 5');
});

test('a date stamp becomes its month, numbers stay put, and a variant stays', () => {
  assert.equal(modelLabel('claude-haiku-4-5-20251001'), 'Claude Haiku 4.5 (Oct)');
  assert.equal(modelLabel('claude-3-5-sonnet'), 'Claude 3.5 Sonnet');
  assert.equal(modelLabel('claude-opus-5-5[1m]'), 'Claude Opus 5.5 (1M)');
});

test('GPT ids read the way the picker names them', () => {
  assert.equal(modelLabel('gpt-5.6-terra'), 'GPT-5.6 Terra');
  assert.equal(modelLabel('gpt-6-astra'), 'GPT-6 Astra');
  assert.equal(modelLabel('gpt-5.5'), 'GPT-5.5');
  assert.equal(modelLabel('llama3'), 'llama3');
  assert.equal(modelLabel(''), '');
});

// The pill shows this BEFORE the catalog loads and the catalog's own name after,
// so the two must never disagree. Read the catalog itself rather than a copy.
test('agrees with every Claude name in the house catalog', () => {
  const catalog = readFileSync(new URL('../../../backend/src/services/model-catalog.ts', import.meta.url), 'utf8');
  // Undated ids only: those are what the pill actually shows. The catalog marks a
  // dated snapshot by hand and only where a sibling needs telling apart.
  const pairs = [...catalog.matchAll(/\{ id: '(claude-[^']+)', name: '([^']+)'/g)].filter(([, id]) => !/\d{8}/.test(id));
  assert.ok(pairs.length >= 5, 'the catalog should still list its Claude models');
  for (const [, id, name] of pairs) assert.equal(modelLabel(id), name, id);
});
