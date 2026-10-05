// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * In-memory vector cache for fast semantic search.
 *
 * Loads all embeddings into contiguous Float32Arrays at startup.
 * Updates incrementally as new messages are embedded.
 * Search is a tight dot-product loop — no SQLite per query.
 *
 * Memory: ~15 MB at 10K vectors (384 dims × 4 bytes × 10K).
 */

// Straight to the connection, NOT through the db barrel. db/messages.ts imports
// this file, so reaching back through db.js made a cycle: cards.ts -> messages
// -> here -> the barrel -> solitaire -> registerBoardDescriber, arriving inside
// cards.ts while its own registry const was still in the temporal dead zone.
// Every sibling under db/ imports the connection this way; this one didn't.
import { getDb } from './db/state.js';
import { EMBEDDING_DIM } from './embeddings.js';

interface CacheEntry {
  messageId: string;
  threadId: string;
  threadName: string;
  role: string;
  createdAt: string;
}

// Parallel arrays: metadata[i] corresponds to vectors at offset i * EMBEDDING_DIM
let metadata: CacheEntry[] = [];
let vectors: Float32Array = new Float32Array(0);
let messageIndex: Map<string, number> = new Map(); // messageId → index
let loaded = false;

/** Load all embeddings from DB into memory. Call once at startup. */
export function loadVectorCache(): void {
  const rows = getDb().prepare(`
    SELECT e.message_id, e.vector, m.thread_id, m.role, m.created_at, t.name as thread_name
    FROM message_embeddings e
    JOIN messages m ON m.id = e.message_id
    JOIN threads t ON t.id = m.thread_id
    WHERE m.deleted_at IS NULL
  `).all() as Array<{
    message_id: string; vector: Buffer; thread_id: string;
    role: string; created_at: string; thread_name: string;
  }>;

  const count = rows.length;
  vectors = new Float32Array(count * EMBEDDING_DIM);
  metadata = new Array(count);
  messageIndex = new Map();

  for (let i = 0; i < count; i++) {
    const row = rows[i];
    const buf = row.vector;
    const f32 = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    vectors.set(f32, i * EMBEDDING_DIM);

    metadata[i] = {
      messageId: row.message_id,
      threadId: row.thread_id,
      threadName: row.thread_name,
      role: row.role,
      createdAt: row.created_at,
    };
    messageIndex.set(row.message_id, i);
  }

  loaded = true;
  console.log(`[vector-cache] Loaded ${count} vectors (${(vectors.byteLength / 1024 / 1024).toFixed(1)} MB)`);
}

/** Add or update a single embedding in the cache. Called after embedMessageAsync. */
export function cacheEmbedding(messageId: string, vector: Float32Array, meta: {
  threadId: string; threadName: string; role: string; createdAt: string;
}): void {
  if (!loaded) return;

  const existing = messageIndex.get(messageId);
  if (existing !== undefined) {
    vectors.set(vector, existing * EMBEDDING_DIM);
    metadata[existing] = { messageId, ...meta };
    return;
  }

  const oldLen = metadata.length;
  const newVectors = new Float32Array((oldLen + 1) * EMBEDDING_DIM);
  newVectors.set(vectors);
  newVectors.set(vector, oldLen * EMBEDDING_DIM);
  vectors = newVectors;

  metadata.push({ messageId, ...meta });
  messageIndex.set(messageId, oldLen);
}

/** Add a digest embedding to the live cache. */
export function cacheDigestEmbedding(digestId: string, vector: Float32Array, meta: {
  date: string; content: string;
}): void {
  if (!loaded) return;

  const existing = messageIndex.get(digestId);
  if (existing !== undefined) {
    vectors.set(vector, existing * EMBEDDING_DIM);
    metadata[existing] = {
      messageId: digestId, threadId: '', threadName: `Digest ${meta.date}`,
      role: 'digest', createdAt: new Date().toISOString(),
    };
    return;
  }

  const oldLen = metadata.length;
  const newVectors = new Float32Array((oldLen + 1) * EMBEDDING_DIM);
  newVectors.set(vectors);
  newVectors.set(vector, oldLen * EMBEDDING_DIM);
  vectors = newVectors;

  metadata.push({
    messageId: digestId, threadId: '', threadName: `Digest ${meta.date}`,
    role: 'digest', createdAt: new Date().toISOString(),
  });
  messageIndex.set(digestId, oldLen);
}

export interface SearchFilter {
  threadId?: string;
  role?: string;
  after?: string;
  before?: string;
}

export interface SemanticSearchResult {
  messageId: string;
  threadId: string;
  threadName: string;
  role: string;
  createdAt: string;
  similarity: number;
}

/** Fast vector search with optional pre-filtering. Returns top N results sorted by similarity. */
export function searchVectors(queryVector: Float32Array, limit: number, filter?: SearchFilter): SemanticSearchResult[] {
  if (!loaded || metadata.length === 0) return [];

  const count = metadata.length;
  const dim = EMBEDDING_DIM;
  const hasFilter = filter && (filter.threadId || filter.role || filter.after || filter.before);

  const heap: SemanticSearchResult[] = [];
  let minScore = -Infinity;

  for (let i = 0; i < count; i++) {
    const m = metadata[i];

    if (hasFilter) {
      if (filter!.threadId && m.threadId !== filter!.threadId) continue;
      if (filter!.role && m.role !== filter!.role) continue;
      if (filter!.after && m.createdAt < filter!.after) continue;
      if (filter!.before && m.createdAt > filter!.before) continue;
    }

    let dot = 0;
    const offset = i * dim;
    for (let d = 0; d < dim; d++) {
      dot += queryVector[d] * vectors[offset + d];
    }

    if (heap.length < limit) {
      heap.push({ messageId: m.messageId, threadId: m.threadId, threadName: m.threadName, role: m.role, createdAt: m.createdAt, similarity: dot });
      if (heap.length === limit) {
        heap.sort((a, b) => a.similarity - b.similarity);
        minScore = heap[0].similarity;
      }
    } else if (dot > minScore) {
      heap[0] = { messageId: m.messageId, threadId: m.threadId, threadName: m.threadName, role: m.role, createdAt: m.createdAt, similarity: dot };
      heap.sort((a, b) => a.similarity - b.similarity);
      minScore = heap[0].similarity;
    }
  }

  heap.sort((a, b) => b.similarity - a.similarity);
  return heap;
}

export function getCacheStats(): { loaded: boolean; count: number; memoryMb: number } {
  return {
    loaded,
    count: metadata.length,
    memoryMb: Math.round(vectors.byteLength / 1024 / 1024 * 10) / 10,
  };
}
