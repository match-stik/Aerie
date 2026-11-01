// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// How often the house starts a thread on its own (theirs, Oct 31 2026): every
// day, every week, or one that keeps going.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { loadConfig } = await import('../../config.js');
loadConfig(join(mkdtempSync(join(tmpdir(), 'cadence-')), 'none.yaml'));
const { initDb } = await import('./init.js');
const { setConfig } = await import('./config.js');
const { threadCadence, weekStartLocal, dailyThreadsEnabled, createThread, getTodayThread } = await import('./threads.js');
initDb(':memory:');

test('a week starts on the Monday on or before the day', () => {
  assert.equal(weekStartLocal('2026-10-31'), '2026-10-26'); // Saturday
  assert.equal(weekStartLocal('2026-10-26'), '2026-10-26'); // Monday
  assert.equal(weekStartLocal('2026-11-01'), '2026-10-26'); // Sunday
  assert.equal(weekStartLocal('2026-11-02'), '2026-11-02');
});

test('the cadence setting wins, and the old daily switch still means what it meant', () => {
  setConfig('orchestrator.thread_cadence', '');
  setConfig('orchestrator.daily_threads', 'true');
  assert.equal(threadCadence(), 'daily');
  setConfig('orchestrator.daily_threads', 'false');
  assert.equal(threadCadence(), 'continuous');
  assert.equal(dailyThreadsEnabled(), false);
  setConfig('orchestrator.thread_cadence', 'weekly');
  assert.equal(threadCadence(), 'weekly');
  assert.equal(dailyThreadsEnabled(), true);
});

test("weekly: a thread opened earlier this week is still today's thread", () => {
  setConfig('orchestrator.thread_cadence', 'weekly');
  const now = new Date();
  const monday = weekStartLocal(now.toISOString().slice(0, 10));
  createThread({ id: 'week-thread', name: monday, type: 'daily', createdAt: `${monday}T12:00:00.000Z` });
  assert.equal(getTodayThread()?.id, 'week-thread');
  setConfig('orchestrator.thread_cadence', 'daily');
  const isMonday = now.toISOString().slice(0, 10) === monday;
  assert.equal(getTodayThread()?.id === 'week-thread', isMonday, 'daily only finds it on its own day');
});
