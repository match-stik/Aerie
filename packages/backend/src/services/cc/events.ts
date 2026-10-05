// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Command Center — Events

import { getDb } from '../db.js';
import { today, uuid } from './helpers.js';

export interface CcEvent {
  id: string;
  title: string;
  description: string | null;
  start_date: string;
  start_time: string | null;
  end_date: string | null;
  end_time: string | null;
  all_day: number;
  category: string;
  color: string | null;
  recurrence: string | null;
  reminder_minutes: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export function addEvent(params: {
  title: string;
  start_date: string;
  start_time?: string;
  end_date?: string;
  end_time?: string;
  all_day?: boolean;
  description?: string;
  category?: string;
  color?: string;
  recurrence?: string;
  reminder_minutes?: number;
  created_by?: string;
}): CcEvent {
  const db = getDb();
  const id = uuid();
  db.prepare(`
    INSERT INTO events (id, title, description, start_date, start_time, end_date, end_time, all_day, category, color, recurrence, reminder_minutes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, params.title, params.description || null, params.start_date, params.start_time || null,
    params.end_date || null, params.end_time || null, params.all_day ? 1 : 0,
    params.category || 'default', params.color || null, params.recurrence || null,
    params.reminder_minutes ?? null, params.created_by || null);
  return db.prepare('SELECT * FROM events WHERE id = ?').get(id) as CcEvent;
}

export function listEvents(params: {
  start_date?: string;
  end_date?: string;
  category?: string;
}): CcEvent[] {
  const db = getDb();
  const start = params.start_date || today();
  const end = params.end_date || (() => { const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().split('T')[0]; })();
  const conditions = ['start_date >= ? AND start_date <= ?'];
  const values: any[] = [start, end];
  if (params.category) {
    conditions.push('category = ?');
    values.push(params.category);
  }
  return db.prepare(`SELECT * FROM events WHERE ${conditions.join(' AND ')} ORDER BY start_date, start_time`).all(...values) as CcEvent[];
}

export function updateEvent(id: string, updates: Partial<{
  title: string;
  description: string;
  start_date: string;
  start_time: string;
  end_date: string;
  end_time: string;
  all_day: boolean;
  category: string;
  color: string;
  recurrence: string;
  reminder_minutes: number;
}>): boolean {
  const sets: string[] = ['updated_at = datetime(\'now\')'];
  const values: any[] = [];

  if (updates.title !== undefined) { sets.push('title = ?'); values.push(updates.title); }
  if (updates.description !== undefined) { sets.push('description = ?'); values.push(updates.description); }
  if (updates.start_date !== undefined) { sets.push('start_date = ?'); values.push(updates.start_date); }
  if (updates.start_time !== undefined) { sets.push('start_time = ?'); values.push(updates.start_time); }
  if (updates.end_date !== undefined) { sets.push('end_date = ?'); values.push(updates.end_date); }
  if (updates.end_time !== undefined) { sets.push('end_time = ?'); values.push(updates.end_time); }
  if (updates.all_day !== undefined) { sets.push('all_day = ?'); values.push(updates.all_day ? 1 : 0); }
  if (updates.category !== undefined) { sets.push('category = ?'); values.push(updates.category); }
  if (updates.color !== undefined) { sets.push('color = ?'); values.push(updates.color); }
  if (updates.recurrence !== undefined) { sets.push('recurrence = ?'); values.push(updates.recurrence); }
  if (updates.reminder_minutes !== undefined) { sets.push('reminder_minutes = ?'); values.push(updates.reminder_minutes); }

  values.push(id);
  const result = getDb().prepare(`UPDATE events SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return result.changes > 0;
}

export function deleteEvent(id: string): boolean {
  const result = getDb().prepare('DELETE FROM events WHERE id = ?').run(id);
  return result.changes > 0;
}
