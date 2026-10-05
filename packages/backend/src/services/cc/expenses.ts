// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Command Center — Expenses

import { getDb } from '../db.js';
import { today, uuid } from './helpers.js';

export function addExpense(params: {
  amount: number;
  category?: string;
  description?: string;
  paid_by?: string;
  date?: string;
}): any {
  const db = getDb();
  const id = uuid();
  db.prepare('INSERT INTO expenses (id, amount, category, description, paid_by, date) VALUES (?, ?, ?, ?, ?, ?)').run(
    id, params.amount, params.category || 'other', params.description || null, params.paid_by || null, params.date || today());
  return db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
}

export function listExpenses(params: {
  start_date?: string;
  end_date?: string;
  category?: string;
  paid_by?: string;
  limit?: number;
}): { expenses: any[]; total: number } {
  const db = getDb();
  const conditions: string[] = [];
  const values: any[] = [];

  if (params.start_date) { conditions.push('date >= ?'); values.push(params.start_date); }
  if (params.end_date) { conditions.push('date <= ?'); values.push(params.end_date); }
  if (params.category) { conditions.push('category = ?'); values.push(params.category); }
  if (params.paid_by) { conditions.push('paid_by = ?'); values.push(params.paid_by); }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  const limit = params.limit || 50;

  const expenses = db.prepare(`SELECT * FROM expenses ${where} ORDER BY date DESC LIMIT ?`).all(...values, limit) as any[];
  const totalRow = db.prepare(`SELECT SUM(amount) as total FROM expenses ${where}`).get(...values) as any;
  return { expenses, total: totalRow?.total || 0 };
}

export function getExpenseStats(period: string = 'month'): any {
  const db = getDb();
  const now = new Date();
  let startDate: string;

  if (period === 'week') {
    const d = new Date(now);
    d.setDate(d.getDate() - d.getDay());
    startDate = d.toISOString().split('T')[0];
  } else if (period === 'year') {
    startDate = `${now.getFullYear()}-01-01`;
  } else {
    startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  }

  const byCategory = db.prepare('SELECT category, SUM(amount) as total, COUNT(*) as count FROM expenses WHERE date >= ? GROUP BY category ORDER BY total DESC').all(startDate) as any[];
  const byPerson = db.prepare('SELECT paid_by, SUM(amount) as total, COUNT(*) as count FROM expenses WHERE date >= ? GROUP BY paid_by ORDER BY total DESC').all(startDate) as any[];
  const totalRow = db.prepare('SELECT SUM(amount) as total, COUNT(*) as count FROM expenses WHERE date >= ?').get(startDate) as any;

  const daysSince = Math.max(1, Math.round((now.getTime() - new Date(startDate).getTime()) / 86400000));

  return {
    period,
    startDate,
    total: totalRow?.total || 0,
    count: totalRow?.count || 0,
    dailyAverage: totalRow?.total ? Math.round((totalRow.total / daysSince) * 100) / 100 : 0,
    byCategory,
    byPerson,
  };
}
