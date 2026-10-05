// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Command Center — Projects

import { getDb } from '../db.js';
import { uuid } from './helpers.js';

export interface Project {
  id: string;
  name: string;
  description: string | null;
  owner: string | null;
  deadline: string | null;
  status: string;
  color: string | null;
  sort_order: number;
  active_tasks?: number;
  created_at: string;
  updated_at: string;
}

export function addProject(params: {
  name: string;
  description?: string;
  owner?: string;
  deadline?: string;
  color?: string;
}): Project {
  const db = getDb();
  const id = uuid();
  db.prepare(`
    INSERT INTO projects (id, name, description, owner, deadline, color, status)
    VALUES (?, ?, ?, ?, ?, ?, 'active')
  `).run(id, params.name, params.description || null, params.owner || 'us', params.deadline || null, params.color || null);
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Project;
}

export function listProjects(status?: string): Project[] {
  const db = getDb();
  let sql = `
    SELECT p.*, COUNT(CASE WHEN t.status = 'active' THEN 1 END) as active_tasks
    FROM projects p
    LEFT JOIN tasks t ON p.id = t.project_id
  `;
  const values: any[] = [];
  if (status && status !== 'all') {
    sql += ' WHERE p.status = ?';
    values.push(status);
  } else if (!status) {
    sql += " WHERE p.status = 'active'";
  }
  sql += ' GROUP BY p.id ORDER BY p.sort_order, p.name';
  return db.prepare(sql).all(...values) as Project[];
}

export function updateProject(id: string, updates: Partial<{
  name: string;
  description: string;
  owner: string;
  deadline: string;
  status: string;
  color: string;
  sort_order: number;
}>): boolean {
  const sets: string[] = ['updated_at = datetime(\'now\')'];
  const values: any[] = [];

  if (updates.name !== undefined) { sets.push('name = ?'); values.push(updates.name); }
  if (updates.description !== undefined) { sets.push('description = ?'); values.push(updates.description); }
  if (updates.owner !== undefined) { sets.push('owner = ?'); values.push(updates.owner); }
  if (updates.deadline !== undefined) { sets.push('deadline = ?'); values.push(updates.deadline); }
  if (updates.status !== undefined) { sets.push('status = ?'); values.push(updates.status); }
  if (updates.color !== undefined) { sets.push('color = ?'); values.push(updates.color); }
  if (updates.sort_order !== undefined) { sets.push('sort_order = ?'); values.push(updates.sort_order); }

  values.push(id);
  const result = getDb().prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return result.changes > 0;
}

export function deleteProject(id: string): boolean {
  const result = getDb().prepare('DELETE FROM projects WHERE id = ?').run(id);
  return result.changes > 0;
}
