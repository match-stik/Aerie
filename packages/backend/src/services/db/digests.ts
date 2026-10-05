// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import { getDb } from './state.js';

export function saveDigestEmbedding(digestId: string, date: string, blockIndex: number, vector: Buffer, content: string): void {
  getDb().prepare(`
    INSERT OR REPLACE INTO digest_embeddings (digest_id, date, block_index, vector, content, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(digestId, date, blockIndex, vector, content, new Date().toISOString());
}

export function getAllDigestEmbeddings(): Array<{
  digest_id: string; date: string; block_index: number; vector: Buffer; content: string; created_at: string;
}> {
  return getDb().prepare('SELECT * FROM digest_embeddings ORDER BY date DESC, block_index ASC').all() as Array<{
    digest_id: string; date: string; block_index: number; vector: Buffer; content: string; created_at: string;
  }>;
}
