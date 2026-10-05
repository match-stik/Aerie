// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AllBackendsFailedError,
  DEFAULT_FALLBACK_CHAIN,
  PAID_BACKENDS,
  planAttempts,
  parseFallbackChain,
  runWithFallback,
  type ImageBackend,
} from './image-fallback.js';

// THE GUARANTEE, and the only one worth a test on its own: an outage must never
// turn into a bill. A metered backend can be reached deliberately or because the owner
// typed it into the chain, never because the free one fell over.
test('the default chain contains nothing metered', () => {
  for (const backend of DEFAULT_FALLBACK_CHAIN) {
    assert.equal(PAID_BACKENDS.has(backend), false, `${backend} is metered`);
  }
});

test('the requested backend goes first and nothing gets two goes', () => {
  assert.deepEqual(planAttempts('codex', ['codex', 'antigravity']), ['codex', 'antigravity']);
  assert.deepEqual(planAttempts('antigravity', ['codex', 'antigravity']), ['antigravity', 'codex']);
  assert.deepEqual(planAttempts('openart', []), ['openart']);
});

test('a chain the owner wrote is honoured, including a metered one they typed themselves', () => {
  assert.deepEqual(parseFallbackChain('antigravity,openart'), ['antigravity', 'openart']);
  assert.deepEqual(parseFallbackChain(' CODEX , antigravity '), ['codex', 'antigravity']);
  assert.deepEqual(parseFallbackChain('antigravity,openai'), ['antigravity', 'openai']);
  assert.deepEqual(parseFallbackChain('antigravity,antigravity'), ['antigravity']);
  assert.deepEqual(parseFallbackChain('nonsense'), []);
});

// Switching fallback OFF has to be possible without deleting the key, so an
// empty string means "no fallback" rather than "fall back to the default".
test('an empty chain means no fallback, not the default', () => {
  assert.deepEqual(parseFallbackChain(''), []);
  assert.deepEqual(parseFallbackChain('   '), []);
  assert.deepEqual(parseFallbackChain(undefined), [...DEFAULT_FALLBACK_CHAIN]);
  assert.deepEqual(parseFallbackChain(null), [...DEFAULT_FALLBACK_CHAIN]);
});

test('the first backend that produces something wins and the rest are never asked', () => {
  const asked: ImageBackend[] = [];
  return runWithFallback(['codex', 'antigravity'], async (backend) => {
    asked.push(backend);
    return `picture from ${backend}`;
  }).then((outcome) => {
    assert.equal(outcome.backend, 'codex');
    assert.equal(outcome.result, 'picture from codex');
    assert.deepEqual(outcome.failed, []);
    assert.deepEqual(asked, ['codex']);
  });
});

test('a refusal walks on, and the picture reports who actually took it', async () => {
  const outcome = await runWithFallback(['codex', 'antigravity'], async (backend) => {
    if (backend === 'codex') throw new Error('404 Not Found');
    return `picture from ${backend}`;
  });
  assert.equal(outcome.backend, 'antigravity');
  assert.deepEqual(outcome.failed, [{ backend: 'codex', error: '404 Not Found' }]);
});

// If the fallback also fails, the LAST error is the least interesting one. The
// reason the first backend said no is the thing somebody has to read.
test('when everything refuses, every refusal survives in order', async () => {
  await assert.rejects(
    runWithFallback(['codex', 'antigravity'], async (backend) => {
      throw new Error(backend === 'codex' ? 'weekly limit reached' : 'model retired upstream');
    }),
    (error: unknown) => {
      assert.ok(error instanceof AllBackendsFailedError);
      assert.deepEqual(error.attempts.map((a) => a.backend), ['codex', 'antigravity']);
      assert.match(error.message, /weekly limit reached/);
      assert.match(error.message, /model retired upstream/);
      return true;
    },
  );
});

test('a single refusal reads as itself rather than as a pile-up', async () => {
  await assert.rejects(
    runWithFallback(['codex'], async () => { throw new Error('weekly limit reached'); }),
    { message: 'weekly limit reached' },
  );
});
