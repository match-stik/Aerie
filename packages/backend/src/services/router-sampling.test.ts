// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// THE ARCHIVIST'S METERED ROAD DIED ON A SAMPLING PARAMETER. The router sent
// temperature to every Claude model
// it did not know was strict, and claude-haiku-5-5 answers that with a 400
// ('`temperature` is deprecated for this model'). Newer models are the ones a
// list falls behind on, so the rule now names the OLD families that still take
// sampling and treats everything else as strict.

const { buildAnthropicBody } = await import('./router.js');
const say = [{ role: 'user' as const, content: 'hi' }];

test('current models get no temperature', () => {
  for (const m of ['claude-haiku-5-5', 'claude-opus-5', 'claude-opus-5-5', 'claude-sonnet-5', 'claude-fable-5-1', 'claude-opus-4-8']) {
    assert.equal(buildAnthropicBody(say, m, { stream: false, thinking: false }).temperature, undefined, m);
  }
});

test('older models still get their temperature', () => {
  for (const m of ['claude-sonnet-4-5', 'claude-haiku-4-5-20251001', 'claude-3-5-sonnet-latest', 'claude-opus-4-1']) {
    assert.equal(buildAnthropicBody(say, m, { stream: false, thinking: false }).temperature, 0.8, m);
  }
});

test('current models think adaptively, never with a token budget', () => {
  const body = buildAnthropicBody(say, 'claude-haiku-5-5', { stream: false, thinking: true });
  assert.deepEqual(body.thinking, { type: 'adaptive' });
});

test('a Claude model that may think on its own gets room to finish writing', async () => {
  // Oct 22 2026: the Archivist's Haiku 5.5 spent all 4096 output tokens before
  // writing a word on most sweeps, because it thinks unasked and that counts.
  const { buildAnthropicBody } = await import('./router.js');
  const msgs = [{ role: 'user', content: 'hi' }] as any;
  assert.equal(buildAnthropicBody(msgs, 'claude-haiku-5-5', { stream: false, thinking: false }).max_tokens, 16000);
  assert.equal(buildAnthropicBody(msgs, 'claude-haiku-5-5', { stream: false, thinking: true }).max_tokens, 16000);
  assert.equal(buildAnthropicBody(msgs, 'claude-3-5-sonnet-20241022', { stream: false, thinking: false }).max_tokens, 4096, 'an older model that cannot think keeps the old ceiling');
});
