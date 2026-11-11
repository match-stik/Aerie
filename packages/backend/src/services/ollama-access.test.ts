// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyProbe, filterByAccess, isOllamaCloud, needsCheck } from './ollama-access.js';

test('only the cloud is filtered, and a probe reads as ok, refused, or nothing learned', () => {
  assert.equal(isOllamaCloud('https://ollama.com'), true);
  assert.equal(isOllamaCloud('http://127.0.0.1:11434'), false);
  assert.equal(classifyProbe(200, '{}'), 'ok');
  assert.equal(classifyProbe(402, '{"error":"this model is not included in your free usage"}'), 'blocked');
  assert.equal(classifyProbe(400, '{"error":"clef:27b is a decision model and only supports /v1/systemone"}'), 'blocked');
  assert.equal(classifyProbe(500, 'oops'), 'unknown');
  assert.equal(classifyProbe(400, '{"error":"bad request"}'), 'unknown');
});

test('the picker drops what the account refused and keeps anything it has not been asked about', () => {
  const access = { checkedAt: 1000, ok: ['gemma4:31b'], blocked: { 'kimi-k3': '402' } };
  assert.deepEqual(filterByAccess(['gemma4:31b', 'kimi-k3', 'brand-new'], access), ['gemma4:31b', 'brand-new']);
  assert.deepEqual(filterByAccess(['kimi-k3'], null), ['kimi-k3']);
  assert.equal(needsCheck(['gemma4:31b', 'kimi-k3'], access, 1000 + 60_000), false);
  assert.equal(needsCheck(['gemma4:31b', 'brand-new'], access, 1000 + 60_000), true);
  assert.equal(needsCheck(['gemma4:31b'], access, 1000 + 25 * 3600_000), true);
  assert.equal(needsCheck(['gemma4:31b'], null), true);
});
