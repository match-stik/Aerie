// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import { fuseWhisperResults, isSurprising } from './whisper-ranking.js';

test('hybrid fusion rewards a memory found by both lanes', () => {
  const semantic = [
    { id: 'semantic-only', content: 'semantic', similarity: 0.8 },
    { id: 'both', content: 'both', similarity: 0.7 },
  ];
  const keyword = [
    { id: 'both', content: 'both', cue: 'Flint' },
    { id: 'keyword-only', content: 'keyword', cue: 'Flint' },
  ];
  const fused = fuseWhisperResults(semantic, keyword);
  assert.equal(fused[0]?.id, 'both');
  assert.equal(fused[0]?.cue, 'Flint');
  assert.equal(new Set(fused.map(item => item.id)).size, 3);
});

test('surprise gate skips semantically unchanged turns', () => {
  const cosine = (a: Float32Array, b: Float32Array) => a[0] * b[0] + a[1] * b[1];
  const previous = new Float32Array([1, 0]);
  assert.equal(isSurprising(new Float32Array([0.99, 0.01]), previous, cosine), false);
  assert.equal(isSurprising(new Float32Array([0, 1]), previous, cosine), true);
  assert.equal(isSurprising(new Float32Array([1, 0]), undefined, cosine), true);
});
