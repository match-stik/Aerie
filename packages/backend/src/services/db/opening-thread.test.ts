// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The room the app opens into on a brand-new house (found Nov 26 2026: a fresh
// install opened in the companions' Treehouse and the first hello landed there).
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { loadConfig } = await import('../../config.js');
loadConfig(join(mkdtempSync(join(tmpdir(), 'opening-')), 'none.yaml'));
const { initDb } = await import('./init.js');
const { getDb } = await import('./state.js');
const { setConfig, getConfig } = await import('./config.js');
const { createThread, getOpeningThread } = await import('./threads.js');
initDb(':memory:');

function fresh(): void {
  getDb().prepare('DELETE FROM threads').run();
  setConfig('orchestrator.wake_thread_id', '');
  createThread({ id: 'tree', name: 'The Treehouse', type: 'treehouse', createdAt: new Date().toISOString() });
}

test('a house with only the Treehouse gets today\'s thread to open into, once', () => {
  fresh();
  setConfig('orchestrator.thread_cadence', 'daily');
  const first = getOpeningThread();
  assert.ok(first);
  assert.equal(first!.type, 'daily');
  const again = getOpeningThread();
  assert.equal(again!.id, first!.id);
  assert.equal((getDb().prepare("SELECT COUNT(*) AS n FROM threads WHERE type != 'treehouse'").get() as { n: number }).n, 1);
});

test('a house that keeps one thread going gets one, and it becomes the home thread', () => {
  fresh();
  setConfig('orchestrator.thread_cadence', 'continuous');
  const home = getOpeningThread();
  assert.ok(home);
  assert.equal(home!.type, 'named');
  assert.equal(getConfig('orchestrator.wake_thread_id'), home!.id);
  assert.equal(getOpeningThread()!.id, home!.id);
});

test('a house that already has a conversation is never handed a new one', () => {
  fresh();
  setConfig('orchestrator.thread_cadence', 'continuous');
  createThread({ id: 'chat', name: 'Ours', type: 'named', createdAt: new Date().toISOString() });
  assert.equal(getOpeningThread(), null);
  assert.equal((getDb().prepare('SELECT COUNT(*) AS n FROM threads').get() as { n: number }).n, 2);
});

test('a room opened before the first hello (the Screening Room, say) is not a conversation', () => {
  fresh();
  setConfig('orchestrator.thread_cadence', 'daily');
  createThread({ id: 'screen', name: 'The Screening Room', type: 'named', createdAt: new Date().toISOString() });
  setConfig('screening.thread_id', 'screen');
  const opening = getOpeningThread();
  assert.ok(opening);
  assert.notEqual(opening!.id, 'screen');
  assert.equal(opening!.type, 'daily');
  setConfig('screening.thread_id', '');
});
