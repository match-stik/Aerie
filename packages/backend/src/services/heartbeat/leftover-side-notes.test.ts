// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { leftoverSideNotes, onLeftoverSideNotes, reportLeftoverSideNotes } from './supervisor.js';

test('a note the read mark covers is answered; one after it is left over', () => {
  const notes = [
    { at: '2026-10-19T05:33:58.681Z', text: 'first' },
    { at: '2026-10-19T05:38:51.047Z', text: 'second' },
  ];
  assert.deepEqual(leftoverSideNotes(notes, '2026-10-19T05:33:58.681Z').map((n) => n.text), ['second']);
  assert.equal(leftoverSideNotes(notes, '').length, 2);
  assert.equal(leftoverSideNotes(notes, '2026-10-19T06:00:00.000Z').length, 0);
});

test('leftovers reach the handler with their thread, and nothing is reported empty', () => {
  const seen: Array<[string, number]> = [];
  onLeftoverSideNotes((thread, notes) => seen.push([thread, notes.length]));
  reportLeftoverSideNotes('home', [{ at: 'x', text: 'y' }]);
  reportLeftoverSideNotes('home', []);
  reportLeftoverSideNotes('', [{ at: 'x', text: 'y' }]);
  onLeftoverSideNotes(null);
  assert.deepEqual(seen, [['home', 1]]);
});
