// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import { getDb } from './db/state.js';

export interface MemoryLedgerEntry {
  id: number; actor: string; action: string; subject_type: string | null;
  subject_id: string | null; detail: string; metadata_json: string | null;
  seen_at: string | null; created_at: string;
}

export function memoryReceipt(input: {
  actor: string; action: string; subjectType?: string; subjectId?: string;
  detail: string; metadata?: Record<string, unknown>;
}): void {
  getDb().prepare(`INSERT INTO memory_ledger
    (actor, action, subject_type, subject_id, detail, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(input.actor, input.action, input.subjectType || null, input.subjectId || null,
      input.detail.slice(0, 500), input.metadata ? JSON.stringify(input.metadata) : null, new Date().toISOString());
}

export function listMemoryLedger(limit = 100, offset = 0): MemoryLedgerEntry[] {
  return getDb().prepare('SELECT * FROM memory_ledger ORDER BY id DESC LIMIT ? OFFSET ?')
    .all(Math.min(500, Math.max(1, limit)), Math.max(0, offset)) as MemoryLedgerEntry[];
}

export function markMemoryLedgerSeen(throughId: number): void {
  getDb().prepare('UPDATE memory_ledger SET seen_at = COALESCE(seen_at, ?) WHERE id <= ?')
    .run(new Date().toISOString(), throughId);
}
