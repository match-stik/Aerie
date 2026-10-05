// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Command Center — Cycle Tracking

import { getDb } from '../db.js';
import { today, uuid } from './helpers.js';

export function getCycleSettings(): { average_cycle_length: number; average_period_length: number } {
  const db = getDb();
  const row = db.prepare('SELECT * FROM cycle_settings LIMIT 1').get() as any;
  if (!row) {
    db.prepare("INSERT INTO cycle_settings (id, average_cycle_length, average_period_length) VALUES ('1', 28, 5)").run();
    return { average_cycle_length: 28, average_period_length: 5 };
  }
  return { average_cycle_length: row.average_cycle_length, average_period_length: row.average_period_length };
}

export function updateCycleAverages(): void {
  const db = getDb();
  const cycles = db.prepare('SELECT * FROM cycles ORDER BY start_date DESC LIMIT 12').all() as any[];
  if (cycles.length < 2) return;

  const completeCycles = cycles.filter(c => c.end_date);
  const cycleLengths: number[] = [];
  const periodLengths: number[] = [];

  for (let i = 0; i < completeCycles.length - 1; i++) {
    const curr = new Date(completeCycles[i].start_date);
    const prev = new Date(completeCycles[i + 1].start_date);
    const len = Math.round((curr.getTime() - prev.getTime()) / 86400000);
    if (len > 0 && len < 60) cycleLengths.push(len);
  }

  for (const c of completeCycles) {
    if (c.end_date) {
      const len = Math.round((new Date(c.end_date).getTime() - new Date(c.start_date).getTime()) / 86400000) + 1;
      if (len > 0 && len < 15) periodLengths.push(len);
    }
  }

  const avgCycle = cycleLengths.length > 0 ? Math.round(cycleLengths.reduce((a, b) => a + b, 0) / cycleLengths.length) : 28;
  const avgPeriod = periodLengths.length > 0 ? Math.round(periodLengths.reduce((a, b) => a + b, 0) / periodLengths.length) : 5;

  db.prepare("INSERT INTO cycle_settings (id, average_cycle_length, average_period_length) VALUES ('1', ?, ?) ON CONFLICT(id) DO UPDATE SET average_cycle_length = excluded.average_cycle_length, average_period_length = excluded.average_period_length, updated_at = datetime('now')").run(avgCycle, avgPeriod);
}

export function startPeriod(date?: string, notes?: string): string {
  const db = getDb();
  const d = date || today();
  // End any open cycle
  const yesterday = new Date(d);
  yesterday.setDate(yesterday.getDate() - 1);
  db.prepare('UPDATE cycles SET end_date = ?, updated_at = datetime(\'now\') WHERE end_date IS NULL').run(yesterday.toISOString().split('T')[0]);
  // Start new cycle
  const id = uuid();
  db.prepare('INSERT INTO cycles (id, start_date, notes) VALUES (?, ?, ?)').run(id, d, notes || null);
  updateCycleAverages();
  return `Period started on ${d}`;
}

export function endPeriod(date?: string): string {
  const db = getDb();
  const d = date || today();
  const result = db.prepare("UPDATE cycles SET end_date = ?, updated_at = datetime('now') WHERE end_date IS NULL").run(d);
  if (result.changes === 0) return 'No open period to end';
  updateCycleAverages();
  return `Period ended on ${d}`;
}

export function logCycleDaily(params: {
  date?: string;
  flow?: string;
  symptoms?: string;
  mood?: string;
  energy?: number;
  notes?: string;
}): string {
  const db = getDb();
  const d = params.date || today();
  const id = uuid();
  db.prepare(`
    INSERT INTO cycle_daily_logs (id, date, flow, symptoms, mood, energy, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      flow = COALESCE(excluded.flow, flow),
      symptoms = COALESCE(excluded.symptoms, symptoms),
      mood = COALESCE(excluded.mood, mood),
      energy = COALESCE(excluded.energy, energy),
      notes = COALESCE(excluded.notes, notes),
      updated_at = datetime('now')
  `).run(id, d, params.flow || null, params.symptoms || null, params.mood || null, params.energy ?? null, params.notes || null);
  return `Logged cycle data for ${d}`;
}

export function getCycleStatus(): Record<string, any> {
  const db = getDb();
  const settings = getCycleSettings();
  const current = db.prepare('SELECT * FROM cycles WHERE end_date IS NULL ORDER BY start_date DESC LIMIT 1').get() as any;
  const lastComplete = db.prepare('SELECT * FROM cycles WHERE end_date IS NOT NULL ORDER BY start_date DESC LIMIT 1').get() as any;
  const recentLogs = db.prepare('SELECT * FROM cycle_daily_logs ORDER BY date DESC LIMIT 5').all() as any[];

  const lastStart = current?.start_date || lastComplete?.start_date;
  if (!lastStart) return { noData: true, settings, recentLogs };

  const todayDate = new Date(today());
  const startDate = new Date(lastStart);
  const cycleDay = Math.round((todayDate.getTime() - startDate.getTime()) / 86400000) + 1;

  let phase: string;
  if (current && !current.end_date && cycleDay <= settings.average_period_length) {
    phase = 'menstrual';
  } else if (cycleDay <= 13) {
    phase = 'follicular';
  } else if (cycleDay <= 16) {
    phase = 'ovulation';
  } else {
    phase = 'luteal';
  }

  const nextPeriod = new Date(startDate);
  nextPeriod.setDate(nextPeriod.getDate() + settings.average_cycle_length);
  const daysUntilPeriod = Math.round((nextPeriod.getTime() - todayDate.getTime()) / 86400000);

  const pmsStart = new Date(nextPeriod);
  pmsStart.setDate(pmsStart.getDate() - 10);
  const inPMSWindow = todayDate >= pmsStart && todayDate < nextPeriod;

  return {
    onPeriod: !!current && !current.end_date,
    periodStarted: current?.start_date || null,
    phase,
    cycleDay,
    cycleLength: settings.average_cycle_length,
    nextPeriodPredicted: nextPeriod.toISOString().split('T')[0],
    daysUntilPeriod,
    inPMSWindow,
    lastPeriodStart: lastStart,
    lastPeriodEnd: lastComplete?.end_date || current?.end_date || null,
    settings,
    recentLogs,
  };
}

export function getCycleHistory(limit = 6): any[] {
  return getDb().prepare('SELECT * FROM cycles ORDER BY start_date DESC LIMIT ?').all(limit) as any[];
}

export function getCyclePredict(): Record<string, any> {
  const settings = getCycleSettings();
  const status = getCycleStatus();
  if (status.noData) return { error: 'No cycle data available' };

  const lastStart = new Date(status.lastPeriodStart);
  const avgCycle = settings.average_cycle_length;

  const nextPeriod = new Date(lastStart);
  nextPeriod.setDate(nextPeriod.getDate() + avgCycle);

  const ovulation = new Date(lastStart);
  ovulation.setDate(ovulation.getDate() + Math.round(avgCycle / 2) - 1);

  const fertileStart = new Date(ovulation);
  fertileStart.setDate(fertileStart.getDate() - 5);

  const pmsStart = new Date(nextPeriod);
  pmsStart.setDate(pmsStart.getDate() - 10);

  const todayDate = new Date(today());

  return {
    nextPeriod: nextPeriod.toISOString().split('T')[0],
    ovulation: ovulation.toISOString().split('T')[0],
    fertileWindow: {
      start: fertileStart.toISOString().split('T')[0],
      end: ovulation.toISOString().split('T')[0],
    },
    pmsWindow: {
      start: pmsStart.toISOString().split('T')[0],
      end: new Date(nextPeriod.getTime() - 86400000).toISOString().split('T')[0],
    },
    inFertileWindow: todayDate >= fertileStart && todayDate <= ovulation,
    inPMSWindow: todayDate >= pmsStart && todayDate < nextPeriod,
  };
}
