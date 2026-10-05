// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Retrieval-quality metadata layered over canonical Cortex memories.
// Adapted from retrieval mechanics in Ori Mnemos (Apache-2.0) and
// agentmemory (MIT); see NOTICE and THIRD_PARTY_LICENSES.md.

import { getDb } from './db.js';
import { embed } from './embeddings.js';
import { searchCortexMemoryIndex } from './cortex-memory-index.js';

const DUPLICATE_THRESHOLD = 0.88;
const WARMTH_BUMP = 0.08;
const WARMTH_CAP = 1;
const EDGE_BUMP = 0.12;
const EDGE_CAP = 1;

export interface DuplicateWarning {
  memoryId: string;
  similarity: number;
  content: string;
}

export async function findNearDuplicates(content: string, domain?: string): Promise<DuplicateWarning[]> {
  if (!content.trim()) return [];
  try {
    const vector = await embed(content);
    return searchCortexMemoryIndex(vector, 5)
      .filter(hit => hit.similarity >= DUPLICATE_THRESHOLD && (!domain || hit.domain === domain))
      .map(hit => ({ memoryId: hit.id, similarity: hit.similarity, content: hit.content }));
  } catch {
    // Memory writes are sacred; an optional warning layer may never block one.
    return [];
  }
}

export function setTemporalValidity(memoryId: string, validFrom?: string | null, validUntil?: string | null): void {
  const now = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO cortex_memory_quality (memory_id, valid_from, valid_until, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(memory_id) DO UPDATE SET
      valid_from = excluded.valid_from, valid_until = excluded.valid_until, updated_at = excluded.updated_at
  `).run(memoryId, validFrom || null, validUntil || null, now);
}

export function isMemoryRetrievable(memoryId: string, now = new Date()): boolean {
  const row = getDb().prepare(`
    SELECT valid_from, valid_until, superseded_by FROM cortex_memory_quality WHERE memory_id = ?
  `).get(memoryId) as { valid_from: string | null; valid_until: string | null; superseded_by: string | null } | undefined;
  if (!row) return true;
  const time = now.getTime();
  if (row.superseded_by) return false;
  if (row.valid_from && Date.parse(row.valid_from) > time) return false;
  if (row.valid_until && Date.parse(row.valid_until) <= time) return false;
  return true;
}

export function supersedeMemory(memoryId: string, supersededBy: string): void {
  getDb().prepare(`
    INSERT INTO cortex_memory_quality (memory_id, superseded_by, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(memory_id) DO UPDATE SET superseded_by = excluded.superseded_by, updated_at = excluded.updated_at
  `).run(memoryId, supersededBy, new Date().toISOString());
}

export function recordFeedback(memoryId: string, kind: 'confirm' | 'correct'): void {
  const column = kind === 'confirm' ? 'confirmations' : 'corrections';
  getDb().prepare(`
    INSERT INTO cortex_memory_quality (memory_id, ${column}, updated_at)
    VALUES (?, 1, ?)
    ON CONFLICT(memory_id) DO UPDATE SET ${column} = ${column} + 1, updated_at = excluded.updated_at
  `).run(memoryId, new Date().toISOString());
}

export function recordRetrieval(memoryIds: string[]): void {
  const ids = [...new Set(memoryIds)].sort();
  if (!ids.length) return;
  const db = getDb();
  const now = new Date().toISOString();
  const warm = db.prepare(`
    INSERT INTO cortex_memory_quality (memory_id, warmth, last_retrieved_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(memory_id) DO UPDATE SET
      warmth = MIN(?, warmth + ?), last_retrieved_at = excluded.last_retrieved_at, updated_at = excluded.updated_at
  `);
  const edge = db.prepare(`
    INSERT INTO cortex_memory_edges (memory_a, memory_b, weight, last_co_retrieved_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(memory_a, memory_b) DO UPDATE SET
      weight = MIN(?, weight + ?), last_co_retrieved_at = excluded.last_co_retrieved_at
  `);
  db.transaction(() => {
    for (const id of ids) warm.run(id, WARMTH_BUMP, now, now, WARMTH_CAP, WARMTH_BUMP);
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      edge.run(ids[i], ids[j], EDGE_BUMP, now, EDGE_CAP, EDGE_BUMP);
    }
  })();
}

/** Activation from memories already present in this warm session. Each edge
 * contributes, but the final boost is capped so familiarity cannot swamp
 * semantic relevance. */
export function spreadingActivation(candidateId: string, activeIds: string[]): number {
  if (!activeIds.length) return 0;
  const placeholders = activeIds.map(() => '?').join(',');
  const row = getDb().prepare(`
    SELECT COALESCE(SUM(weight), 0) AS activation FROM cortex_memory_edges
    WHERE (memory_a = ? AND memory_b IN (${placeholders}))
       OR (memory_b = ? AND memory_a IN (${placeholders}))
  `).get(candidateId, ...activeIds, candidateId, ...activeIds) as { activation: number };
  return Math.min(1, Number(row.activation) || 0);
}

export function extractMemoryId(result: string): string | null {
  try {
    const parsed = JSON.parse(result);
    const id = parsed?.id || parsed?.memory_id || parsed?.memory?.id;
    if (typeof id === 'string') return id;
  } catch { /* worker versions may return prose */ }
  return result.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i)?.[0] || null;
}
