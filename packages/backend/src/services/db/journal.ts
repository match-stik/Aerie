// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Companion journal — self-authored entries and dreams.
// Dreams carry a vividness that decays over time (computed at read),
// strengthens on recall, and freezes once anchored to permanent memory.

import { getDb } from './state.js';
import { memoryReceipt } from '../memory-ledger.js';

export interface JournalEntry {
  id: string;
  companion_id: string;
  entry_type: 'journal' | 'dream';
  content: string;
  dream_type: string | null;
  emerged_question: string | null;
  vividness: number | null;
  anchored_at: string | null;
  last_recalled_at: string | null;
  created_at: string;
}

/** Points of vividness a dream loses per day it goes unrecalled. */
const DECAY_PER_DAY = 4;

/** Effective vividness right now — stored value minus decay since last touch. */
export function effectiveVividness(entry: JournalEntry): number | null {
  if (entry.entry_type !== 'dream' || entry.vividness === null) return null;
  if (entry.anchored_at) return entry.vividness; // anchored dreams don't fade
  const since = entry.last_recalled_at || entry.created_at;
  const days = Math.max(0, (Date.now() - new Date(since).getTime()) / 86_400_000);
  return Math.max(0, Math.round(entry.vividness - days * DECAY_PER_DAY));
}

export function createJournalEntry(entry: {
  id: string;
  companionId: string;
  entryType?: 'journal' | 'dream';
  content: string;
  dreamType?: string | null;
  emergedQuestion?: string | null;
}): JournalEntry {
  const entryType = entry.entryType === 'dream' ? 'dream' : 'journal';
  const now = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO journal_entries (id, companion_id, entry_type, content, dream_type, emerged_question, vividness, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.id,
    entry.companionId,
    entryType,
    entry.content,
    entryType === 'dream' ? (entry.dreamType || 'processing') : null,
    entry.emergedQuestion || null,
    entryType === 'dream' ? 100 : null,
    now,
  );
  memoryReceipt({ actor: entry.companionId, action: `journal.${entryType}.create`, subjectType: 'journal_entry', subjectId: entry.id, detail: `Created a ${entryType} entry.` });
  return getJournalEntry(entry.id)!;
}

export function getJournalEntry(id: string): JournalEntry | null {
  const row = getDb().prepare('SELECT * FROM journal_entries WHERE id = ?').get(id) as JournalEntry | undefined;
  return row || null;
}

export function listJournalEntries(opts?: {
  companionId?: string;
  entryType?: 'journal' | 'dream';
  limit?: number;
  offset?: number;
}): { entries: JournalEntry[]; total: number } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts?.companionId) {
    where.push('companion_id = ?');
    params.push(opts.companionId);
  }
  if (opts?.entryType) {
    where.push('entry_type = ?');
    params.push(opts.entryType);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (getDb().prepare(`SELECT COUNT(*) as c FROM journal_entries ${whereSql}`).get(...params) as { c: number }).c;
  const entries = getDb().prepare(
    `SELECT * FROM journal_entries ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, opts?.limit ?? 50, opts?.offset ?? 0) as JournalEntry[];
  return { entries, total };
}

/** Recall a dream — strengthens vividness (+15, cap 100) and resets its decay clock. */
export function recallJournalEntry(id: string): JournalEntry | null {
  const entry = getJournalEntry(id);
  if (!entry) return null;
  const now = new Date().toISOString();
  if (entry.entry_type === 'dream' && entry.vividness !== null && !entry.anchored_at) {
    const current = effectiveVividness(entry) ?? entry.vividness;
    const strengthened = Math.min(100, current + 15);
    getDb().prepare('UPDATE journal_entries SET vividness = ?, last_recalled_at = ? WHERE id = ?')
      .run(strengthened, now, id);
  } else {
    getDb().prepare('UPDATE journal_entries SET last_recalled_at = ? WHERE id = ?').run(now, id);
  }
  memoryReceipt({ actor: entry.companion_id, action: 'journal.recall', subjectType: 'journal_entry', subjectId: id, detail: 'Recalled a journal entry.' });
  return getJournalEntry(id);
}

/** Anchor an entry — freezes it as permanent. The caller files it to Cortex. */
export function anchorJournalEntry(id: string): JournalEntry | null {
  const entry = getJournalEntry(id);
  if (!entry) return null;
  const now = new Date().toISOString();
  const frozen = entry.entry_type === 'dream' ? (effectiveVividness(entry) ?? entry.vividness) : entry.vividness;
  getDb().prepare('UPDATE journal_entries SET anchored_at = ?, vividness = ? WHERE id = ?')
    .run(now, frozen, id);
  memoryReceipt({ actor: entry.companion_id, action: 'journal.anchor', subjectType: 'journal_entry', subjectId: id, detail: 'Anchored a journal entry.' });
  return getJournalEntry(id);
}

/** Update the content of a journal entry (companion self-edit). */
export function updateJournalEntry(id: string, content: string): JournalEntry | null {
  const entry = getJournalEntry(id);
  if (!entry) return null;
  getDb().prepare('UPDATE journal_entries SET content = ? WHERE id = ?').run(content, id);
  memoryReceipt({ actor: entry.companion_id, action: 'journal.update', subjectType: 'journal_entry', subjectId: id, detail: 'Updated a journal entry.' });
  return getJournalEntry(id);
}

export function deleteJournalEntry(id: string): boolean {
  const entry = getJournalEntry(id);
  const result = getDb().prepare('DELETE FROM journal_entries WHERE id = ?').run(id);
  if (result.changes > 0) memoryReceipt({ actor: entry?.companion_id || 'house', action: 'journal.delete', subjectType: 'journal_entry', subjectId: id, detail: 'Deleted a journal entry.' });
  return result.changes > 0;
}
