// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Local semantic mirror for Cortex memories.
// Linked-memory activation and reinforcement mechanics are adapted from
// Ori Mnemos (Apache-2.0); see NOTICE.
//
// Cortex remains canonical. This service periodically lists its durable
// memories, embeds changed rows with Reverie's existing local MiniLM model,
// and keeps only the resulting search cache in the house SQLite database.

import { createHash } from 'crypto';
import * as cortex from './cortex.js';
import { isArchiveRecord } from './archive-artifact.js';
import { getDb } from './db.js';
import { bufferToVector, cosineSimilarity, embed, vectorToBuffer } from './embeddings.js';

const PAGE_SIZE = 500;
const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

export interface IndexedCortexMemory {
  id: string;
  content: string;
  domain: string;
  category: string;
  created_at: string;
}

export interface SemanticCortexResult extends IndexedCortexMemory {
  similarity: number;
  warmth: number;
  confirmations: number;
  corrections: number;
}

let refreshPromise: Promise<void> | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let scheduledRefresh: ReturnType<typeof setTimeout> | null = null;

function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function searchCortexMemoryIndex(
  queryVector: Float32Array,
  limit = 8,
  activeIds: string[] = [],
): SemanticCortexResult[] {
  const rows = getDb().prepare(`
    SELECT e.memory_id, e.content, e.domain, e.category, e.source_created_at, e.vector,
      COALESCE(q.warmth, 0) warmth, COALESCE(q.confirmations, 0) confirmations,
      COALESCE(q.corrections, 0) corrections
    FROM cortex_memory_embeddings e
    LEFT JOIN cortex_memory_quality q ON q.memory_id = e.memory_id
    WHERE q.superseded_by IS NULL
      AND (q.valid_from IS NULL OR julianday(q.valid_from) <= julianday('now'))
      AND (q.valid_until IS NULL OR julianday(q.valid_until) > julianday('now'))
  `).all() as Array<{
    memory_id: string;
    content: string;
    domain: string | null;
    category: string | null;
    source_created_at: string | null;
    vector: Buffer;
    warmth: number;
    confirmations: number;
    corrections: number;
  }>;

  // Lazy import avoided here: local SQL keeps this hot path synchronous.
  const edgeRows = activeIds.length ? getDb().prepare(`
    SELECT memory_a, memory_b, weight FROM cortex_memory_edges
    WHERE memory_a IN (${activeIds.map(() => '?').join(',')})
       OR memory_b IN (${activeIds.map(() => '?').join(',')})
  `).all(...activeIds, ...activeIds) as Array<{ memory_a: string; memory_b: string; weight: number }> : [];
  const activation = new Map<string, number>();
  const active = new Set(activeIds);
  for (const edge of edgeRows) {
    const candidate = active.has(edge.memory_a) ? edge.memory_b : edge.memory_a;
    if (!active.has(candidate)) activation.set(candidate, (activation.get(candidate) || 0) + edge.weight);
  }

  return rows
    .map(row => ({
      id: row.memory_id,
      content: row.content,
      domain: row.domain || 'general',
      category: row.category || '',
      created_at: row.source_created_at || '',
      similarity: cosineSimilarity(queryVector, bufferToVector(row.vector)),
      warmth: row.warmth,
      confirmations: row.confirmations,
      corrections: row.corrections,
    }))
    .sort((a, b) => {
      const score = (x: typeof a) => x.similarity
        + Math.min(0.05, x.warmth * 0.05)
        + Math.min(0.08, (activation.get(x.id) || 0) * 0.08)
        + Math.min(0.03, x.confirmations * 0.01)
        - Math.min(0.06, x.corrections * 0.02);
      return score(b) - score(a);
    })
    .slice(0, Math.max(0, limit));
}

async function runRefresh(): Promise<void> {
  if (!cortex.isConfigured()) return;

  const memories: IndexedCortexMemory[] = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  while (offset < total) {
    const page = await cortex.listAllMemories(PAGE_SIZE, offset);
    const results = Array.isArray(page.results) ? page.results : [];
    memories.push(...results.map(m => ({
      id: m.id,
      content: m.content || '',
      domain: m.domain || 'general',
      category: m.category || '',
      created_at: m.created_at || '',
    })).filter(m => !isArchiveRecord(m)));
    total = Number.isFinite(page.total) ? page.total : memories.length;
    if (results.length === 0 || results.length < PAGE_SIZE) break;
    offset += results.length;
  }

  const db = getDb();
  const existing = db.prepare(
    'SELECT memory_id, content_hash FROM cortex_memory_embeddings'
  ).all() as Array<{ memory_id: string; content_hash: string }>;
  const hashes = new Map(existing.map(row => [row.memory_id, row.content_hash]));
  const upsert = db.prepare(`
    INSERT INTO cortex_memory_embeddings
      (memory_id, content, domain, category, source_created_at, content_hash, vector, indexed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(memory_id) DO UPDATE SET
      content = excluded.content,
      domain = excluded.domain,
      category = excluded.category,
      source_created_at = excluded.source_created_at,
      content_hash = excluded.content_hash,
      vector = excluded.vector,
      indexed_at = excluded.indexed_at
  `);

  let changed = 0;
  for (const memory of memories) {
    if (!memory.id || !memory.content.trim()) continue;
    const hash = contentHash(memory.content);
    if (hashes.get(memory.id) === hash) continue;
    const vector = await embed(memory.content);
    upsert.run(
      memory.id,
      memory.content,
      memory.domain,
      memory.category,
      memory.created_at,
      hash,
      vectorToBuffer(vector),
      new Date().toISOString(),
    );
    changed++;
  }

  // A complete listing is authoritative: remove local vectors for memories
  // deleted from Cortex. Never mutate Cortex from this mirror.
  if (offset + PAGE_SIZE >= total || memories.length >= total) {
    const liveIds = new Set(memories.map(m => m.id));
    const remove = db.prepare('DELETE FROM cortex_memory_embeddings WHERE memory_id = ?');
    const deleteMissing = db.transaction(() => {
      for (const row of existing) {
        if (!liveIds.has(row.memory_id)) {
          remove.run(row.memory_id);
          db.prepare('DELETE FROM cortex_memory_quality WHERE memory_id = ?').run(row.memory_id);
          db.prepare('DELETE FROM cortex_memory_edges WHERE memory_a = ? OR memory_b = ?').run(row.memory_id, row.memory_id);
        }
      }
    });
    deleteMissing();
  }

  console.log(`[whisper-index] Cortex mirror ready: ${memories.length} memories, ${changed} embedded`);
}

export function refreshCortexMemoryIndex(): Promise<void> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = runRefresh()
    .catch(error => console.warn('[whisper-index] Refresh failed (non-fatal):', error))
    .finally(() => { refreshPromise = null; });
  return refreshPromise;
}

export function startCortexMemoryIndex(): void {
  void refreshCortexMemoryIndex();
  if (!refreshTimer) {
    refreshTimer = setInterval(() => void refreshCortexMemoryIndex(), REFRESH_INTERVAL_MS);
    refreshTimer.unref?.();
  }
}

/** Coalesce write-triggered refreshes so a burst of Cortex filing produces
 * one listing pass rather than one pass per memory. */
export function scheduleCortexMemoryIndexRefresh(delayMs = 1500): void {
  if (scheduledRefresh) clearTimeout(scheduledRefresh);
  scheduledRefresh = setTimeout(() => {
    scheduledRefresh = null;
    void refreshCortexMemoryIndex();
  }, delayMs);
  scheduledRefresh.unref?.();
}
