// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Command Center — Countdowns

import { getDb } from '../db.js';
import { today, uuid } from './helpers.js';

export function addCountdown(params: { title: string; target_date: string; emoji?: string; color?: string }): any {
  const db = getDb();
  const id = uuid();
  db.prepare('INSERT INTO countdowns (id, title, target_date, emoji, color) VALUES (?, ?, ?, ?, ?)').run(
    id, params.title, params.target_date, params.emoji || null, params.color || null);
  return db.prepare('SELECT * FROM countdowns WHERE id = ?').get(id);
}

export function listCountdowns(): any[] {
  const rows = getDb().prepare('SELECT * FROM countdowns ORDER BY target_date').all() as any[];
  const todayDate = new Date(today());
  return rows.map(r => ({
    ...r,
    days_until: Math.round((new Date(r.target_date).getTime() - todayDate.getTime()) / 86400000),
  }));
}

export function deleteCountdown(id: string): boolean {
  const result = getDb().prepare('DELETE FROM countdowns WHERE id = ?').run(id);
  return result.changes > 0;
}
