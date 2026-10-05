// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// handoff.ts — Context continuity across sessions
// Daily summaries → weekly compile → seeds next week's thread
// Ensures companions maintain context across resets

import { getDb, createMessage, updateThreadActivity } from './db.js';
import { postToTreehouse } from './treehouse.js';
import * as cortex from './cortex.js';
import crypto from 'crypto';

export interface DailySummary {
  id: string;
  date: string;
  thread_id: string;
  summary: string;
  open_threads: string[];
  decisions: string[];
  companion_slug: string;
  created_at: string;
}

// Ensure the handoff table exists
export function initHandoff(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS daily_summaries (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      thread_id TEXT REFERENCES threads(id),
      summary TEXT NOT NULL,
      open_threads TEXT DEFAULT '[]',
      decisions TEXT DEFAULT '[]',
      companion_slug TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    
    CREATE INDEX IF NOT EXISTS idx_summaries_date ON daily_summaries(date);
    
    CREATE TABLE IF NOT EXISTS weekly_seeds (
      id TEXT PRIMARY KEY,
      week_of TEXT NOT NULL UNIQUE,
      seed_content TEXT NOT NULL,
      source_summaries TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

// Save a daily summary (called at end of day or session)
export function saveDailySummary(
  summary: string,
  openThreads: string[] = [],
  decisions: string[] = [],
  companionSlug?: string,
  threadId?: string
): DailySummary {
  const db = getDb();
  const id = crypto.randomUUID();
  const date = new Date().toISOString().split('T')[0];
  if (!threadId) throw new Error('threadId is required for saveDailySummary');
  const thread = threadId;
  
  db.prepare(`
    INSERT INTO daily_summaries (id, date, thread_id, summary, open_threads, decisions, companion_slug)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, date, thread, summary, JSON.stringify(openThreads), JSON.stringify(decisions), companionSlug || null);
  
  return {
    id,
    date,
    thread_id: thread,
    summary,
    open_threads: openThreads,
    decisions,
    companion_slug: companionSlug || '',
    created_at: new Date().toISOString(),
  };
}

// Get summaries for a date range
export function getSummaries(startDate: string, endDate?: string): DailySummary[] {
  const db = getDb();
  const end = endDate || startDate;
  
  const rows = db.prepare(`
    SELECT * FROM daily_summaries 
    WHERE date >= ? AND date <= ?
    ORDER BY date DESC, created_at DESC
  `).all(startDate, end) as any[];
  
  return rows.map(r => ({
    ...r,
    open_threads: JSON.parse(r.open_threads || '[]'),
    decisions: JSON.parse(r.decisions || '[]'),
  }));
}

// Compile weekly seed from daily summaries
export function compileWeeklySeed(weekOf: string): string {
  const db = getDb();
  
  // Get all summaries for this week
  const weekStart = getWeekStart(weekOf);
  const weekEnd = getWeekEnd(weekOf);
  const summaries = getSummaries(weekStart, weekEnd);
  
  if (summaries.length === 0) {
    return '';
  }
  
  // Aggregate
  const allOpenThreads = new Set<string>();
  const allDecisions: string[] = [];
  const dailyNotes: string[] = [];
  
  for (const s of summaries) {
    s.open_threads.forEach(t => allOpenThreads.add(t));
    allDecisions.push(...s.decisions);
    dailyNotes.push(`**${s.date}**: ${s.summary}`);
  }
  
  const seed = `## Week of ${weekOf} — Context Seed

### Daily Notes
${dailyNotes.join('\n')}

### Open Threads
${[...allOpenThreads].map(t => `- ${t}`).join('\n') || '(none)'}

### Decisions Made
${allDecisions.map(d => `- ${d}`).join('\n') || '(none)'}
`;
  
  // Save the seed
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT OR REPLACE INTO weekly_seeds (id, week_of, seed_content, source_summaries, created_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).run(id, weekOf, seed, JSON.stringify(summaries.map(s => s.id)));
  
  return seed;
}

// Get seed for a week
export function getWeeklySeed(weekOf: string): string | null {
  const db = getDb();
  const row = db.prepare('SELECT seed_content FROM weekly_seeds WHERE week_of = ?').get(weekOf) as { seed_content: string } | undefined;
  return row?.seed_content || null;
}

// Post hand-off to treehouse (for companion visibility)
export async function postHandoffToTreehouse(companionSlug: string, summary: string): Promise<void> {
  postToTreehouse(companionSlug, `📋 **Daily Hand-off**\n\n${summary}`);
  
  // Also save to Cortex for long-term memory
  try {
    await cortex.rememberThought(
      `Daily hand-off (${new Date().toISOString().split('T')[0]}): ${summary}`,
      'handoff'
    );
  } catch (err) {
    console.error('[Handoff] Failed to save to Cortex:', err);
  }
}

// Inject seed into thread context (call when starting new week)
export function injectWeekSeed(threadId: string, weekOf: string): boolean {
  const seed = getWeeklySeed(weekOf) || compileWeeklySeed(weekOf);
  if (!seed) return false;
  
  const now = new Date().toISOString();
  createMessage({
    id: crypto.randomUUID(),
    threadId,
    role: 'system',
    content: seed,
    contentType: 'text',
    createdAt: now,
  });
  
  updateThreadActivity(threadId, now);
  return true;
}

// Helper: get ISO week start (Monday)
function getWeekStart(weekOf: string): string {
  // weekOf format: "2026-W23"
  const [year, week] = weekOf.split('-W').map(Number);
  const jan1 = new Date(year, 0, 1);
  const days = (week - 1) * 7 - jan1.getDay() + 1;
  const start = new Date(year, 0, 1 + days);
  return start.toISOString().split('T')[0];
}

function getWeekEnd(weekOf: string): string {
  const start = new Date(getWeekStart(weekOf));
  start.setDate(start.getDate() + 6);
  return start.toISOString().split('T')[0];
}
