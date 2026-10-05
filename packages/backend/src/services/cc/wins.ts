// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Command Center — Daily Wins

import { getDb } from '../db.js';
import { getAerieConfig } from '../../config.js';
import { today, uuid } from './helpers.js';

export function upsertDailyWin(params: { text: string; who?: string; date?: string }): any {
  const db = getDb();
  const d = params.date || today();
  const who = (params.who || getAerieConfig().command_center.default_person).toLowerCase();
  const id = uuid();
  db.prepare(`
    INSERT INTO daily_wins (id, date, who, text)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(date, who) DO UPDATE SET text = excluded.text
  `).run(id, d, who, params.text);
  return db.prepare('SELECT * FROM daily_wins WHERE date = ? AND who = ?').get(d, who);
}

export function getDailyWins(date?: string): any[] {
  return getDb().prepare('SELECT * FROM daily_wins WHERE date = ?').all(date || today()) as any[];
}
