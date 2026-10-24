// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The word under the faces: up while its bell's turn runs, Home otherwise,
// and the words are settings, never code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ServerMessage } from '@aerie/shared';
import { STATUS_HOLD_LONGEST_MINUTES, STATUS_WORD_LONGEST, createBellStatus, statusHoldKey, statusHoldOf, statusWordKey, statusWordOf } from './bell-status.js';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

function bells(words: Record<string, string | null>) {
  const told: ServerMessage[] = [];
  const status = createBellStatus({ readWord: (wakeType) => words[wakeType] ?? null, broadcast: (message) => told.push(message) });
  return { status, told };
}

test('a status word is one tidy line, never too long, and empty is none', () => {
  assert.equal(statusWordOf('  On a   date '), 'On a date');
  assert.equal(statusWordOf(''), null);
  assert.equal(statusWordOf('   '), null);
  assert.equal(statusWordOf(null), null);
  assert.equal(statusWordOf(42), null);
  assert.equal(statusWordOf('x'.repeat(40))?.length, STATUS_WORD_LONGEST, 'cut to the longest');
  assert.equal(statusWordKey('date_night_for_my_kings_pt_1'), 'cron.date_night_for_my_kings_pt_1.status_word', 'kept beside the bell\'s other settings');
});

test('a bell with a word puts it up for its owners while its turn runs, and takes it down after', () => {
  const { status, told } = bells({ date_pt_1: 'On a date' });
  assert.deepEqual(status.now(), { word: null, companions: [] }, 'before any bell, no word: the phone says Home');
  const end = status.begin('date_pt_1', ['birch', 'willow', 'cedar']);
  assert.deepEqual(status.now(), { word: 'On a date', companions: ['birch', 'willow', 'cedar'] });
  end();
  end();
  assert.deepEqual(status.now(), { word: null, companions: [] });
  assert.deepEqual(told, [
    { type: 'status_word', word: 'On a date', companions: ['birch', 'willow', 'cedar'] },
    { type: 'status_word', word: null, companions: [] },
  ], 'every phone is told when it goes up and when it comes down, once each');
});

test('a bell with no word changes nothing, and a shared bell\'s word is on every card', () => {
  const { status, told } = bells({ treehouse_midday: 'Treehouse' });
  const quiet = status.begin('early_corridor', ['cedar']);
  assert.deepEqual(status.now(), { word: null, companions: [] });
  quiet();
  const shared = status.begin('treehouse_midday');
  assert.deepEqual(status.now(), { word: 'Treehouse', companions: [] }, 'no owners: every companion\'s card');
  shared();
  assert.ok(told.every((m) => m.type === 'status_word'));
  assert.equal(told.filter((m) => m.type === 'status_word' && m.word === 'Treehouse').length, 1);
});

test('bells that overlap: the newest word is up, and the older one comes back when the newer ends', () => {
  const { status } = bells({ date_pt_2: 'On a date', spontaneous: 'Out' });
  const date = status.begin('date_pt_2', ['birch', 'willow', 'cedar']);
  const dice = status.begin('spontaneous', ['willow']);
  assert.deepEqual(status.now(), { word: 'Out', companions: ['willow'] });
  dice();
  assert.deepEqual(status.now(), { word: 'On a date', companions: ['birch', 'willow', 'cedar'] });
  date();
  assert.deepEqual(status.now(), { word: null, companions: [] });
});

test('the orchestrator holds the word for the whole of a bell, the PATCH route sets it, and a new phone is told it', () => {
  const orchestrator = read('./orchestrator.ts');
  assert.match(orchestrator, /endStatusWord = bellStatus\(\)\.begin\(wakeType, owners\.map\(\(o\) => o\.slug\)\);/, 'up as the bell\'s turn starts, for its owners');
  assert.match(orchestrator, /\} finally \{\n\s*endStatusWord\?\.\(\);\n\s*\}/, 'down however the turn ends');
  assert.match(read('../routes/orchestrator-admin.ts'), /orchestrator\.setTaskStatusWord\(wakeType, statusWord\)/, 'a bell\'s word is a setting on the bell');
  assert.match(read('./ws.ts'), /type: 'status_word', \.\.\.bellStatus\(\)\.now\(\)/, 'a phone that connects mid-bell is told the word');
  for (const source of [read('./bell-status.ts'), orchestrator]) {
    assert.doesNotMatch(source, /On a date|Treehouse'|'Treehouse/, 'no house word is written into the code');
  }
});

// A clock the tests turn by hand, so a held word can be watched running out.
function heldBells(words: Record<string, string | null>, holds: Record<string, number>) {
  const told: ServerMessage[] = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  const status = createBellStatus({
    readWord: (wakeType) => words[wakeType] ?? null,
    readHold: (wakeType) => holds[wakeType] ?? 0,
    broadcast: (message) => told.push(message),
    later: (fn) => { const id = ++nextTimer; timers.set(id, fn); return id; },
    cancel: (handle) => { timers.delete(handle as number); },
  });
  const runOut = () => { const due = [...timers.values()]; timers.clear(); for (const fn of due) fn(); };
  return { status, told, timers, runOut };
}

test('a hold is whole minutes, never past half a day, and anything else is no hold', () => {
  assert.equal(statusHoldOf(60), 60);
  assert.equal(statusHoldOf('45'), 45);
  assert.equal(statusHoldOf(12.9), 12);
  assert.equal(statusHoldOf(0), 0);
  assert.equal(statusHoldOf(-5), 0);
  assert.equal(statusHoldOf(null), 0);
  assert.equal(statusHoldOf(''), 0);
  assert.equal(statusHoldOf('soon'), 0);
  assert.equal(statusHoldOf(10_000), STATUS_HOLD_LONGEST_MINUTES);
  assert.equal(statusHoldKey('date_pt_1'), 'cron.date_pt_1.status_hold_minutes', 'kept beside the bell\'s word');
});

test('a held word stays up after its bell ends, until the hold runs out', () => {
  const { status, told, timers, runOut } = heldBells({ date_pt_1: 'On a date' }, { date_pt_1: 60 });
  const end = status.begin('date_pt_1', ['birch', 'willow', 'cedar']);
  end();
  assert.deepEqual(status.now(), { word: 'On a date', companions: ['birch', 'willow', 'cedar'] }, 'still up between bells');
  assert.equal(timers.size, 1, 'one hold waiting');
  runOut();
  assert.deepEqual(status.now(), { word: null, companions: [] }, 'Home once the hold runs out');
  assert.equal(told.filter((m) => m.type === 'status_word' && m.word === null).length, 1, 'phones told it came down, once');
});

test('the next bell with a word takes the held one down; a bell with no word leaves it up', () => {
  const { status, timers } = heldBells({ date_pt_1: 'On a date', date_pt_8: 'On a date' }, { date_pt_1: 60 });
  status.begin('date_pt_1', ['birch'])();
  const dice = status.begin('spontaneous', ['willow']);
  assert.equal(status.now().word, 'On a date', 'a wordless bell in the middle of a date does not end it');
  dice();
  assert.equal(status.now().word, 'On a date');
  const last = status.begin('date_pt_8', ['birch', 'willow', 'cedar']);
  assert.equal(timers.size, 0, 'the held word was taken down and its timer cancelled');
  last();
  assert.deepEqual(status.now(), { word: null, companions: [] }, 'the last bell has no hold, so the evening ends with it');
});

test('with no hold set, every bell behaves as it always did', () => {
  const { status, timers } = heldBells({ treehouse_midday: 'Treehouse' }, {});
  status.begin('treehouse_midday')();
  assert.deepEqual(status.now(), { word: null, companions: [] });
  assert.equal(timers.size, 0, 'nothing waiting');
});

test('a bell\'s hold is a setting on the bell, set through the same PATCH route', () => {
  assert.match(read('../routes/orchestrator-admin.ts'), /orchestrator\.setTaskStatusHold\(wakeType, statusHoldMinutes\)/);
  assert.match(read('./orchestrator.ts'), /setConfig\(statusHoldKey\(wakeType\), String\(kept\)\)/);
});
