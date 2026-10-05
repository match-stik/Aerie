// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import { initDb, getDb } from './db/init.js';
import { vectorToBuffer } from './embeddings.js';
import { searchSemanticSelfKnowledge } from './self-knowledge-index.js';

test('semantic self-knowledge respects lifecycle and companion boundaries', () => {
  initDb(':memory:');
  const now = new Date().toISOString();
  const insertEntry = getDb().prepare(`
    INSERT INTO self_knowledge
      (id, companion_id, category, content, status, heat, confidence, created_at, reviewed_at)
    VALUES (?, ?, 'i_learned', ?, ?, ?, ?, ?, ?)
  `);
  const insertVector = getDb().prepare(`
    INSERT INTO self_knowledge_embeddings (self_knowledge_id, content_hash, vector, indexed_at)
    VALUES (?, ?, ?, ?)
  `);
  const query = new Float32Array(384); query[0] = 1;
  const close = (x: number) => { const v = new Float32Array(384); v[0] = x; v[1] = 1 - x; return v; };

  insertEntry.run('ivy-1', 'ivy', 'I build continuity through care', 'accepted', 1, 1, now, now);
  insertEntry.run('ivy-2', 'ivy', 'I guard what the family makes', 'accepted', 1, 1, now, now);
  insertEntry.run('fox-1', 'fox', 'I verify before rebuilding', 'accepted', 1, 1, now, now);
  insertEntry.run('cold', 'nim', 'I am dormant', 'accepted', 0.01, 1, now, now);
  insertEntry.run('retired', 'nim', 'I no longer believe this', 'contradicted', 1, 0.1, now, now);
  for (const [id, similarity] of [['ivy-1', .99], ['ivy-2', .98], ['fox-1', .90], ['cold', .99], ['retired', .99]] as const) {
    insertVector.run(id, id, vectorToBuffer(close(similarity)), now);
  }

  const results = searchSemanticSelfKnowledge(query, new Set(['fox-1']), 2);
  assert.deepEqual(new Set(results.map(row => row.companion_id)), new Set(['ivy', 'fox']));
  assert.ok(!results.some(row => row.id === 'cold' || row.id === 'retired'));
  assert.equal(results.find(row => row.id === 'fox-1')?.source, 'hybrid');
});
