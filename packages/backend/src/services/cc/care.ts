// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Command Center — Care Entries

import { getDb } from '../db.js';
import { getAerieConfig } from '../../config.js';
import { today, uuid } from './helpers.js';

export interface CareEntry {
  id: string;
  date: string;
  person: string;
  category: string;
  value: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export function upsertCareEntry(params: {
  id?: string;
  date?: string;
  person?: string;
  category: string;
  value?: string;
  note?: string;
}): CareEntry {
  const db = getDb();
  const id = params.id || uuid();
  const date = params.date || today();
  const person = params.person || getAerieConfig().command_center.default_person;

  db.prepare(`
    INSERT INTO care_entries (id, date, person, category, value, note)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(date, person, category) DO UPDATE SET
      value = COALESCE(excluded.value, value),
      note = COALESCE(excluded.note, note),
      updated_at = datetime('now')
  `).run(id, date, person, params.category, params.value || null, params.note || null);

  return db.prepare('SELECT * FROM care_entries WHERE date = ? AND person = ? AND category = ?').get(date, person, params.category) as CareEntry;
}

export function getCareEntries(date: string, person?: string): CareEntry[] {
  const db = getDb();
  if (person) {
    return db.prepare('SELECT * FROM care_entries WHERE date = ? AND person = ? ORDER BY category').all(date, person) as CareEntry[];
  }
  return db.prepare('SELECT * FROM care_entries WHERE date = ? ORDER BY person, category').all(date) as CareEntry[];
}

export function getCareHistory(person: string, days = 7): CareEntry[] {
  const db = getDb();
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().split('T')[0];
  return db.prepare('SELECT * FROM care_entries WHERE person = ? AND date >= ? ORDER BY date DESC, category').all(person, sinceStr) as CareEntry[];
}

export function deleteCareEntry(id: string): boolean {
  const result = getDb().prepare('DELETE FROM care_entries WHERE id = ?').run(id);
  return result.changes > 0;
}
