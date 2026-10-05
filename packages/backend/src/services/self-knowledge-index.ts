// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Semantic retrieval for the living self-knowledge layer.

import { createHash } from 'crypto';
import { getDb } from './db.js';
import { bufferToVector, cosineSimilarity, embed, vectorToBuffer } from './embeddings.js';
import { effectiveHeat, isSurfaceable, type SelfKnowledgeEntry } from './db/self-knowledge.js';

export interface SemanticSelfKnowledgeResult extends SelfKnowledgeEntry {
  similarity: number;
  score: number;
  source: 'semantic' | 'hybrid';
}

const CANDIDATE_THRESHOLD = 0.32;
const ABSTAIN_THRESHOLD = 0.40;
let refreshPromise: Promise<void> | null = null;
let scheduledRefresh: ReturnType<typeof setTimeout> | null = null;

function hash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function refreshSelfKnowledgeIndex(): Promise<void> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const db = getDb();
    const entries = db.prepare('SELECT * FROM self_knowledge').all() as SelfKnowledgeEntry[];
    const existing = new Map((db.prepare(
      'SELECT self_knowledge_id, content_hash FROM self_knowledge_embeddings'
    ).all() as Array<{ self_knowledge_id: string; content_hash: string }>)
      .map(row => [row.self_knowledge_id, row.content_hash]));
    const upsert = db.prepare(`
      INSERT INTO self_knowledge_embeddings (self_knowledge_id, content_hash, vector, indexed_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(self_knowledge_id) DO UPDATE SET
        content_hash = excluded.content_hash, vector = excluded.vector, indexed_at = excluded.indexed_at
    `);
    for (const entry of entries) {
      const input = `${entry.category.replaceAll('_', ' ')}: ${entry.content}`;
      const contentHash = hash(input);
      if (existing.get(entry.id) === contentHash) continue;
      upsert.run(entry.id, contentHash, vectorToBuffer(await embed(input)), new Date().toISOString());
    }
    const live = new Set(entries.map(entry => entry.id));
    const remove = db.prepare('DELETE FROM self_knowledge_embeddings WHERE self_knowledge_id = ?');
    for (const id of existing.keys()) if (!live.has(id)) remove.run(id);
  })().catch(error => console.warn('[self-knowledge-index] Refresh failed (non-fatal):', error))
    .finally(() => { refreshPromise = null; });
  return refreshPromise;
}

export function scheduleSelfKnowledgeIndexRefresh(delayMs = 250): void {
  if (scheduledRefresh) clearTimeout(scheduledRefresh);
  scheduledRefresh = setTimeout(() => {
    scheduledRefresh = null;
    void refreshSelfKnowledgeIndex();
  }, delayMs);
  scheduledRefresh.unref?.();
}

export function searchSemanticSelfKnowledge(
  queryVector: Float32Array,
  keywordIds: Set<string> = new Set(),
  limit = 6,
): SemanticSelfKnowledgeResult[] {
  const rows = getDb().prepare(`
    SELECT sk.*, e.vector FROM self_knowledge sk
    JOIN self_knowledge_embeddings e ON e.self_knowledge_id = sk.id
    WHERE sk.status = 'accepted'
  `).all() as Array<SelfKnowledgeEntry & { vector: Buffer }>;
  const ranked = rows.filter(isSurfaceable).map(row => {
    const similarity = cosineSimilarity(queryVector, bufferToVector(row.vector));
    const keywordBoost = keywordIds.has(row.id) ? 0.10 : 0;
    return {
      ...row,
      similarity,
      score: similarity * 0.65 + effectiveHeat(row) * 0.25 + row.confidence * 0.10 + keywordBoost,
      source: keywordBoost ? 'hybrid' as const : 'semantic' as const,
    };
  }).filter(row => row.similarity >= CANDIDATE_THRESHOLD).sort((a, b) => b.score - a.score);
  if (!ranked.some(row => row.similarity >= ABSTAIN_THRESHOLD)) return [];

  // Give each companion's identity one slot before any companion takes two.
  const selected: SemanticSelfKnowledgeResult[] = [];
  const seenCompanions = new Set<string>();
  for (const row of ranked) {
    if (seenCompanions.has(row.companion_id)) continue;
    selected.push(row);
    seenCompanions.add(row.companion_id);
    if (selected.length >= limit) return selected;
  }
  for (const row of ranked) {
    if (!selected.some(selectedRow => selectedRow.id === row.id)) selected.push(row);
    if (selected.length >= limit) break;
  }
  return selected;
}
