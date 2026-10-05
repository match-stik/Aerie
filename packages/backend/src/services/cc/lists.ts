// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Command Center — Lists

import { getDb } from '../db.js';
import { uuid, resolveListId } from './helpers.js';

export function createList(params: { name: string; icon?: string; color?: string }): any {
  const db = getDb();
  const id = uuid();
  const maxOrder = (db.prepare('SELECT MAX(sort_order) as m FROM lists').get() as any)?.m || 0;
  db.prepare('INSERT INTO lists (id, name, icon, color, sort_order) VALUES (?, ?, ?, ?, ?)').run(
    id, params.name, params.icon || null, params.color || null, maxOrder + 1);
  return db.prepare('SELECT * FROM lists WHERE id = ?').get(id);
}

export function deleteList(id: string): boolean {
  const db = getDb();
  // Delete items first, then the list
  db.prepare('DELETE FROM list_items WHERE list_id = ?').run(id);
  const result = db.prepare('DELETE FROM lists WHERE id = ?').run(id);
  return result.changes > 0;
}

// Alias for backward compat
export const deleteLst = deleteList;

export function addListItems(listId: string, items: string[], addedBy?: string): number {
  const db = getDb();
  const stmt = db.prepare('INSERT INTO list_items (id, list_id, text, added_by) VALUES (?, ?, ?, ?)');
  let count = 0;
  for (const item of items) {
    stmt.run(uuid(), listId, item, addedBy || null);
    count++;
  }
  return count;
}

export function checkListItem(itemId: string, checked = true): boolean {
  const result = getDb().prepare('UPDATE list_items SET checked = ? WHERE id = ?').run(checked ? 1 : 0, itemId);
  return result.changes > 0;
}

export function getListWithItems(listId?: string, listName?: string): any {
  const id = resolveListId(listId, listName);
  if (!id) return null;
  const db = getDb();
  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(id);
  const items = db.prepare('SELECT * FROM list_items WHERE list_id = ? ORDER BY checked ASC, created_at').all(id);
  return { ...list as any, items };
}

export function getAllLists(): any[] {
  const db = getDb();
  const lists = db.prepare('SELECT * FROM lists ORDER BY sort_order').all() as any[];
  for (const list of lists) {
    list.item_count = (db.prepare('SELECT COUNT(*) as c FROM list_items WHERE list_id = ?').get(list.id) as any).c;
    list.unchecked_count = (db.prepare('SELECT COUNT(*) as c FROM list_items WHERE list_id = ? AND checked = 0').get(list.id) as any).c;
  }
  return lists;
}

export function clearListItems(listId: string, all = false): number {
  const db = getDb();
  if (all) {
    const result = db.prepare('DELETE FROM list_items WHERE list_id = ?').run(listId);
    return result.changes;
  }
  const result = db.prepare('DELETE FROM list_items WHERE list_id = ? AND checked = 1').run(listId);
  return result.changes;
}
