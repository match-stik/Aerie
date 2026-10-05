// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import { initDb, getDb } from './db/init.js';
import { vectorToBuffer } from './embeddings.js';
import { searchCortexMemoryIndex } from './cortex-memory-index.js';
import { recordFeedback, recordRetrieval, setTemporalValidity, supersedeMemory } from './cortex-memory-quality.js';

test('local Cortex mirror ranks normalized vectors by semantic similarity', () => {
  initDb(':memory:');
  const insert = getDb().prepare(`
    INSERT INTO cortex_memory_embeddings
      (memory_id, content, domain, category, source_created_at, content_hash, vector, indexed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const close = new Float32Array(384);
  close[0] = 1;
  const far = new Float32Array(384);
  far[1] = 1;
  const now = new Date().toISOString();
  insert.run('close', 'record store', 'lore', '', now, 'a', vectorToBuffer(close), now);
  insert.run('far', 'unrelated', 'technical', '', now, 'b', vectorToBuffer(far), now);

  const results = searchCortexMemoryIndex(close, 2);
  assert.deepEqual(results.map(result => result.id), ['close', 'far']);
  assert.equal(results[0]?.similarity, 1);
  assert.equal(results[1]?.similarity, 0);

  // Retrieval warmth is capped, confirmation is recorded, and co-retrieval
  // creates an edge that can activate a related candidate.
  for (let i = 0; i < 30; i++) recordRetrieval(['close', 'far']);
  recordFeedback('close', 'confirm');
  const quality = getDb().prepare(
    'SELECT warmth, confirmations FROM cortex_memory_quality WHERE memory_id = ?'
  ).get('close') as { warmth: number; confirmations: number };
  assert.equal(quality.warmth, 1);
  assert.equal(quality.confirmations, 1);
  const edge = getDb().prepare(
    'SELECT weight FROM cortex_memory_edges WHERE memory_a = ? AND memory_b = ?'
  ).get('close', 'far') as { weight: number };
  assert.equal(edge.weight, 1);

  setTemporalValidity('far', null, '2000-01-01T00:00:00.000Z');
  assert.deepEqual(searchCortexMemoryIndex(close, 2).map(result => result.id), ['close']);
  setTemporalValidity('far', null, null);
  supersedeMemory('far', 'close');
  assert.deepEqual(searchCortexMemoryIndex(close, 2).map(result => result.id), ['close']);
});
