// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Command Center — Scratchpad

import { getDb } from '../db.js';
import { getAerieConfig } from '../../config.js';
import { today, uuid } from './helpers.js';

export function addScratchpadNote(text: string, created_by?: string): any {
  const db = getDb();
  const id = uuid();
  const by = created_by || getAerieConfig().command_center.default_person;
  db.prepare('INSERT INTO scratchpad_notes (id, text, date, created_by) VALUES (?, ?, ?, ?)').run(id, text, today(), by);
  return db.prepare('SELECT * FROM scratchpad_notes WHERE id = ?').get(id);
}

export function listScratchpadNotes(): any[] {
  return getDb().prepare('SELECT * FROM scratchpad_notes ORDER BY created_at ASC').all() as any[];
}

export function updateScratchpadNote(id: string, text: string): any {
  const db = getDb();
  const result = db.prepare("UPDATE scratchpad_notes SET text = ?, updated_at = datetime('now') WHERE id = ?").run(text, id);
  if (result.changes === 0) throw new Error('Note not found');
  return db.prepare('SELECT * FROM scratchpad_notes WHERE id = ?').get(id);
}

export function deleteScratchpadNote(id: string): boolean {
  return getDb().prepare('DELETE FROM scratchpad_notes WHERE id = ?').run(id).changes > 0;
}

export function clearScratchpadNotes(): number {
  return getDb().prepare('DELETE FROM scratchpad_notes').run().changes;
}

export function getScratchpad(): any {
  const db = getDb();
  const todayDate = today();
  const notes = db.prepare('SELECT * FROM scratchpad_notes ORDER BY created_at ASC').all() as any[];
  const tasks = db.prepare(
    "SELECT t.*, p.name as project_name FROM tasks t LEFT JOIN projects p ON t.project_id = p.id WHERE t.status = 'active' AND t.project_id IS NULL AND t.date IS NULL ORDER BY t.sort_order ASC, t.created_at ASC"
  ).all() as any[];
  const events = db.prepare('SELECT * FROM events WHERE start_date = ? ORDER BY all_day DESC, start_time ASC').all(todayDate) as any[];
  return {
    notes,
    tasks,
    events,
    counts: { notes: notes.length, tasks: tasks.length, events: events.length },
  };
}
