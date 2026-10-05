// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Command Center — Tasks

import { getDb } from '../db.js';
import { getAerieConfig } from '../../config.js';
import { uuid } from './helpers.js';

export interface Task {
  id: string;
  text: string;
  project_id: string | null;
  project_name?: string;
  date: string | null;
  due_date: string | null;
  person: string;
  priority: number;
  status: string;
  sort_order: number;
  created_by: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export function addTask(params: {
  text: string;
  project?: string;
  date?: string;
  due_date?: string;
  person?: string;
  priority?: number;
  created_by?: string;
}): Task {
  const db = getDb();
  const id = uuid();
  let projectId: string | null = null;

  // Auto-create project if name provided
  if (params.project) {
    const existing = db.prepare('SELECT id FROM projects WHERE LOWER(name) = LOWER(?)').get(params.project) as { id: string } | undefined;
    if (existing) {
      projectId = existing.id;
    } else {
      projectId = uuid();
      db.prepare('INSERT INTO projects (id, name, status) VALUES (?, ?, ?)').run(projectId, params.project, 'active');
    }
  }

  db.prepare(`
    INSERT INTO tasks (id, text, project_id, date, due_date, person, priority, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)
  `).run(id, params.text, projectId, params.date || null, params.due_date || null, params.person || getAerieConfig().command_center.default_person, params.priority || 0, params.created_by || null);

  return db.prepare(`
    SELECT t.*, p.name as project_name FROM tasks t
    LEFT JOIN projects p ON t.project_id = p.id WHERE t.id = ?
  `).get(id) as Task;
}

export function listTasks(params: {
  status?: string;
  project?: string;
  date?: string;
  person?: string;
  due_before?: string;
  carry_forward?: boolean;
}): Task[] {
  const db = getDb();
  const conditions: string[] = [];
  const values: any[] = [];

  if (params.status && params.status !== 'all') {
    conditions.push('t.status = ?');
    values.push(params.status);
  } else if (!params.status) {
    conditions.push("t.status = 'active'");
  }

  if (params.project) {
    conditions.push('LOWER(p.name) = LOWER(?)');
    values.push(params.project);
  }

  if (params.person) {
    conditions.push('t.person = ?');
    values.push(params.person);
  }

  if (params.due_before) {
    conditions.push('t.due_date <= ?');
    values.push(params.due_before);
  }

  // Date-scoped with 3-day carry-forward
  if (params.date) {
    if (params.carry_forward) {
      const d = new Date(params.date);
      d.setDate(d.getDate() - 3);
      const carryDate = d.toISOString().split('T')[0];
      conditions.push('(t.date = ? OR (t.date >= ? AND t.date < ? AND t.status = ?))');
      values.push(params.date, carryDate, params.date, 'active');
    } else {
      conditions.push('t.date = ?');
      values.push(params.date);
    }
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  const rows = db.prepare(`
    SELECT t.*, p.name as project_name FROM tasks t
    LEFT JOIN projects p ON t.project_id = p.id
    ${where}
    ORDER BY t.priority DESC, t.due_date, t.sort_order
  `).all(...values) as Task[];

  // Deduplicate carried-forward tasks by title
  if (params.carry_forward && params.date) {
    const seen = new Set<string>();
    return rows.filter(t => {
      const key = t.text.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  return rows;
}

export function completeTask(id?: string, text?: string): string {
  const db = getDb();
  if (id) {
    const result = db.prepare("UPDATE tasks SET status = 'completed', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(id);
    if (result.changes === 0) return 'Task not found';
    const task = db.prepare('SELECT text FROM tasks WHERE id = ?').get(id) as { text: string };
    return `Completed: ${task.text}`;
  }
  if (text) {
    const task = db.prepare("SELECT id, text FROM tasks WHERE text LIKE ? AND status = 'active' LIMIT 1").get(`%${text}%`) as { id: string; text: string } | undefined;
    if (!task) return 'No matching active task found';
    db.prepare("UPDATE tasks SET status = 'completed', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(task.id);
    return `Completed: ${task.text}`;
  }
  return 'Provide task id or text to complete';
}

export function updateTask(id: string, updates: Partial<{
  text: string;
  project: string;
  date: string;
  due_date: string;
  person: string;
  priority: number;
  status: string;
  sort_order: number;
}>): boolean {
  const db = getDb();
  const sets: string[] = ['updated_at = datetime(\'now\')'];
  const values: any[] = [];

  if (updates.text !== undefined) { sets.push('text = ?'); values.push(updates.text); }
  if (updates.date !== undefined) { sets.push('date = ?'); values.push(updates.date); }
  if (updates.due_date !== undefined) { sets.push('due_date = ?'); values.push(updates.due_date); }
  if (updates.person !== undefined) { sets.push('person = ?'); values.push(updates.person); }
  if (updates.priority !== undefined) { sets.push('priority = ?'); values.push(updates.priority); }
  if (updates.status !== undefined) { sets.push('status = ?'); values.push(updates.status); }
  if (updates.sort_order !== undefined) { sets.push('sort_order = ?'); values.push(updates.sort_order); }

  if (updates.project !== undefined) {
    const existing = db.prepare('SELECT id FROM projects WHERE LOWER(name) = LOWER(?)').get(updates.project) as { id: string } | undefined;
    if (existing) {
      sets.push('project_id = ?');
      values.push(existing.id);
    } else {
      const pid = uuid();
      db.prepare('INSERT INTO projects (id, name, status) VALUES (?, ?, ?)').run(pid, updates.project, 'active');
      sets.push('project_id = ?');
      values.push(pid);
    }
  }

  values.push(id);
  const result = db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return result.changes > 0;
}
