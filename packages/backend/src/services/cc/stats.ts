// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Command Center — Stats and Status

import { getDb } from '../db.js';
import { today } from './helpers.js';
import { getCycleStatus, getCycleSettings } from './cycle.js';
import { listCountdowns } from './countdowns.js';
import { getDailyWins } from './wins.js';
import { upcomingPetCare } from './pets.js';

export function getCcStatus(): string {
  const db = getDb();
  const todayStr = today();
  const lines: string[] = [];

  // Moods (from care_entries with category 'mood')
  const moods = db.prepare("SELECT * FROM care_entries WHERE date = ? AND category = 'mood'").all(todayStr) as any[];
  if (moods.length > 0) {
    lines.push('**Moods:** ' + moods.map(m => `${m.person}: ${m.value || ''}${m.note ? ' ' + m.note : ''}`).join(', '));
  }

  // Care summary — dynamic grouping by person field
  const care = db.prepare('SELECT * FROM care_entries WHERE date = ?').all(todayStr) as any[];
  if (care.length > 0) {
    const byPerson = new Map<string, any[]>();
    for (const entry of care) {
      const person = entry.person;
      if (!byPerson.has(person)) byPerson.set(person, []);
      byPerson.get(person)!.push(entry);
    }

    const summarizeCare = (entries: any[], label: string) => {
      const toggles = entries.filter(c => c.value === 'true').map(c => c.category);
      const ratings = entries.filter(c => c.value && !isNaN(Number(c.value)) && c.category !== 'water' && c.category !== 'mood');
      const water = entries.find(c => c.category === 'water');
      const notes = entries.filter(c => c.note).map(c => {
        try { const n = JSON.parse(c.note); return `${c.category}: ${n.map((x: any) => x.text).join('; ')}`; }
        catch { return `${c.category}: ${c.note}`; }
      });
      const parts: string[] = [];
      if (toggles.length > 0) parts.push(`Done: ${toggles.join(', ')}`);
      if (ratings.length > 0) parts.push(ratings.map(r => `${r.category}: ${r.value}/5`).join(', '));
      if (water) parts.push(`Water: ${water.value}/10`);
      let line = `**${label} care:** ` + (parts.length > 0 ? parts.join(' | ') : 'nothing logged yet');
      if (notes.length > 0) line += ` | Notes: ${notes.join(', ')}`;
      return line;
    };

    for (const [person, entries] of byPerson) {
      const label = person.charAt(0).toUpperCase() + person.slice(1);
      lines.push(summarizeCare(entries, label));
    }
  }

  // Today's events
  const events = db.prepare('SELECT * FROM events WHERE start_date = ? ORDER BY start_time').all(todayStr) as any[];
  if (events.length > 0) {
    lines.push('**Today\'s events:** ' + events.map(e => `${e.start_time || 'all day'} ${e.title} (${e.category})`).join(', '));
  }

  // Upcoming events
  const upcoming = db.prepare('SELECT * FROM events WHERE start_date > ? ORDER BY start_date, start_time LIMIT 5').all(todayStr) as any[];
  if (upcoming.length > 0) {
    lines.push('**Upcoming:** ' + upcoming.map(e => `${e.start_date} ${e.title}`).join(', '));
  }

  // Active tasks
  const tasks = db.prepare("SELECT t.*, p.name as project_name FROM tasks t LEFT JOIN projects p ON t.project_id = p.id WHERE t.status = 'active' ORDER BY t.priority DESC, t.due_date").all() as any[];
  if (tasks.length > 0) {
    const byProject = new Map<string, any[]>();
    for (const t of tasks) {
      const key = t.project_name || 'No project';
      if (!byProject.has(key)) byProject.set(key, []);
      byProject.get(key)!.push(t);
    }
    const taskLines: string[] = [];
    for (const [proj, projTasks] of byProject) {
      taskLines.push(`${proj}: ${projTasks.map(t => `${t.priority > 0 ? '!' : ''}${t.text}${t.due_date ? ' (due ' + t.due_date + ')' : ''}`).join(', ')}`);
    }
    lines.push('**Tasks:** ' + taskLines.join(' | '));
  }

  // Cycle status
  try {
    const cycle = getCycleStatus();
    if (!cycle.noData) {
      lines.push(`**Cycle:** Day ${cycle.cycleDay} (${cycle.phase})${cycle.inPMSWindow ? ' ⚠️ PMS window' : ''}${cycle.onPeriod ? ' 🔴 on period' : ''}`);
    }
  } catch { /* no cycle data */ }

  // Countdowns
  const countdowns = listCountdowns().filter(c => c.days_until >= 0).slice(0, 5);
  if (countdowns.length > 0) {
    lines.push('**Countdowns:** ' + countdowns.map(c => `${c.emoji || ''} ${c.title} (${c.days_until}d)`).join(', '));
  }

  // Daily wins
  const wins = getDailyWins(todayStr);
  if (wins.length > 0) {
    lines.push('**Wins:** ' + wins.map(w => `${w.who}: ${w.text}`).join(', '));
  }

  // Pet care upcoming
  const petCare = upcomingPetCare(2);
  if (petCare.length > 0) {
    lines.push('**Pet care:** ' + petCare.map(p => `${p.pet}: ${p.name}${p.overdue ? ' OVERDUE' : p.isToday ? ' TODAY' : ' due ' + p.due}`).join(', '));
  }

  return lines.length > 0 ? lines.join('\n') : 'No data for today yet.';
}

export function updatePet(id: string, updates: Partial<{
  name: string; species: string; breed: string; birthday: string; weight: string; notes: string;
}>): boolean {
  const sets: string[] = [];
  const values: any[] = [];
  if (updates.name !== undefined) { sets.push('name = ?'); values.push(updates.name); }
  if (updates.species !== undefined) { sets.push('species = ?'); values.push(updates.species); }
  if (updates.breed !== undefined) { sets.push('breed = ?'); values.push(updates.breed); }
  if (updates.birthday !== undefined) { sets.push('birthday = ?'); values.push(updates.birthday); }
  if (updates.weight !== undefined) { sets.push('weight = ?'); values.push(updates.weight); }
  if (updates.notes !== undefined) { sets.push('notes = ?'); values.push(updates.notes); }
  if (sets.length === 0) return false;
  values.push(id);
  const result = getDb().prepare(`UPDATE pets SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return result.changes > 0;
}

export function updateListItem(itemId: string, updates: { text?: string; checked?: boolean }): boolean {
  const sets: string[] = [];
  const values: any[] = [];
  if (updates.text !== undefined) { sets.push('text = ?'); values.push(updates.text); }
  if (updates.checked !== undefined) { sets.push('checked = ?'); values.push(updates.checked ? 1 : 0); }
  if (sets.length === 0) return false;
  values.push(itemId);
  const result = getDb().prepare(`UPDATE list_items SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return result.changes > 0;
}

export function deleteListItem(itemId: string): boolean {
  const result = getDb().prepare('DELETE FROM list_items WHERE id = ?').run(itemId);
  return result.changes > 0;
}

export function getTaskStats(days = 14): any {
  const db = getDb();
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().split('T')[0];

  const active = (db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'active'").get() as any).c;
  const overdue = (db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'active' AND due_date IS NOT NULL AND due_date < ?").get(today()) as any).c;
  const completed = (db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'completed' AND completed_at >= ?").get(sinceStr) as any).c;

  const completedPerDay = db.prepare(`
    SELECT date(completed_at) as date, COUNT(*) as count
    FROM tasks WHERE status = 'completed' AND completed_at >= ?
    GROUP BY date(completed_at) ORDER BY date
  `).all(sinceStr) as any[];

  const byProject = db.prepare(`
    SELECT COALESCE(p.name, 'Ungrouped') as name,
      COUNT(CASE WHEN t.status = 'completed' AND t.completed_at >= ? THEN 1 END) as completed,
      COUNT(CASE WHEN t.status = 'active' THEN 1 END) as active
    FROM tasks t LEFT JOIN projects p ON t.project_id = p.id
    WHERE t.status IN ('active', 'completed')
    GROUP BY COALESCE(p.name, 'Ungrouped')
    ORDER BY active DESC
  `).all(sinceStr) as any[];

  return { active, overdue, completed, completedPerDay, byProject };
}

export function getCareStats(person: string, days = 14): any {
  const db = getDb();
  const dates: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().split('T')[0]);
  }
  const since = dates[dates.length - 1];

  const entries = db.prepare('SELECT * FROM care_entries WHERE person = ? AND date >= ? ORDER BY date').all(person, since) as any[];

  const dailyAverages: any[] = [];
  for (const date of dates.reverse()) {
    const dayEntries = entries.filter(e => e.date === date);
    const get = (cat: string) => {
      const e = dayEntries.find(d => d.category === cat);
      return e?.value ? parseFloat(e.value) : null;
    };
    dailyAverages.push({ date, sleep: get('sleep'), energy: get('energy'), wellbeing: get('wellbeing'), mood: get('mood'), water: get('water') });
  }

  const mealCats = ['breakfast', 'lunch', 'dinner'];
  let mealDays = 0;
  let movementDays = 0;
  for (const date of dates) {
    const dayEntries = entries.filter(e => e.date === date);
    const meals = mealCats.filter(cat => dayEntries.find(d => d.category === cat && d.value === 'true'));
    if (meals.length >= 2) mealDays++;
    if (dayEntries.find(d => d.category === 'movement' && d.value === 'true')) movementDays++;
  }

  return { dailyAverages, mealDays, movementDays, totalDays: days };
}

export function getCycleStats(): any {
  const status = getCycleStatus();
  const settings = getCycleSettings();
  if (status.noData) return { noData: true };

  const db = getDb();
  const logs = db.prepare('SELECT * FROM cycle_daily_logs WHERE energy IS NOT NULL ORDER BY date DESC LIMIT 90').all() as any[];

  const energyByDay: Record<number, number[]> = {};
  const cycles = db.prepare('SELECT * FROM cycles ORDER BY start_date DESC LIMIT 12').all() as any[];

  for (const log of logs) {
    for (const cycle of cycles) {
      if (log.date >= cycle.start_date && (!cycle.end_date || log.date <= cycle.end_date)) {
        const cycleDay = Math.round((new Date(log.date).getTime() - new Date(cycle.start_date).getTime()) / 86400000) + 1;
        if (cycleDay > 0 && cycleDay <= 35) {
          if (!energyByDay[cycleDay]) energyByDay[cycleDay] = [];
          energyByDay[cycleDay].push(log.energy);
        }
        break;
      }
    }
  }

  const energyAvgByDay = Object.entries(energyByDay).map(([day, vals]) => ({
    cycleDay: parseInt(day),
    avgEnergy: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10,
  })).sort((a, b) => a.cycleDay - b.cycleDay);

  return {
    avgCycleLength: settings.average_cycle_length,
    avgPeriodLength: settings.average_period_length,
    currentPhase: status.phase,
    cycleDay: status.cycleDay,
    energyByDay: energyAvgByDay,
  };
}
