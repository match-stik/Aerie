// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import { rmSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  appendCodexSideNote,
  codexSideNotesPath,
  codexSideNotesSize,
  deliverSideNoteToBusyCodexLane,
  formatCodexSideNote,
  formatCodexSideNoteHandover,
  readCodexSideNotesFrom,
} from './codex-side-notes.js';

const LANE = 'test-thread:companion:test-cedar';

function freshLane(): string {
  try { rmSync(dirname(codexSideNotesPath(LANE)), { recursive: true, force: true }); } catch { /* first run */ }
  return LANE;
}

test('a lane key with colons becomes a usable path', () => {
  const path = codexSideNotesPath('abc-123:companion:def-456');
  assert.match(path, /codex-lanes[/\\]abc-123_companion_def-456[/\\]side-notes\.jsonl$/);
  assert.equal(path.includes(':companion:'), false);
});

test('a note round-trips and the offset consumes it', () => {
  const lane = freshLane();
  assert.equal(codexSideNotesSize(lane), 0);
  assert.equal(appendCodexSideNote(lane, 'are you still on the drawers?'), true);

  const first = readCodexSideNotesFrom(lane, 0);
  assert.equal(first.notes.length, 1);
  assert.equal(first.notes[0].text, 'are you still on the drawers?');
  assert.ok(first.newOffset > 0);

  // The same offset read again is empty — this is what stops a note being
  // handed over twice and read as the owner repeating themselves.
  assert.deepEqual(readCodexSideNotesFrom(lane, first.newOffset).notes, []);
});

test('the file is history, not an inbox — old notes stay and do not resurface', () => {
  const lane = freshLane();
  appendCodexSideNote(lane, 'first');
  const after = readCodexSideNotesFrom(lane, 0).newOffset;
  appendCodexSideNote(lane, 'second');

  const pending = readCodexSideNotesFrom(lane, after);
  assert.deepEqual(pending.notes.map((n) => n.text), ['second']);
  // Everything is still on disk; only the offset moved.
  assert.equal(readCodexSideNotesFrom(lane, 0).notes.length, 2);
});

test('a truncated file re-reads from the start instead of slicing a line', () => {
  const lane = freshLane();
  appendCodexSideNote(lane, 'only note');
  // An offset past the end can only mean the file was replaced; reading from
  // it would silently drop a real note.
  const recovered = readCodexSideNotesFrom(lane, 999_999);
  assert.deepEqual(recovered.notes.map((n) => n.text), ['only note']);
});

test('notes are collapsed to one line and empty ones are refused', () => {
  assert.equal(formatCodexSideNote('one\ntwo'), 'one two');
  assert.equal(formatCodexSideNote('padded\n   indented'), 'padded indented');
  assert.equal(formatCodexSideNote('   \n  '), null);
  assert.equal(formatCodexSideNote(undefined as unknown as string), null);
  assert.equal(appendCodexSideNote(freshLane(), '  '), false);
});

test('the handover block tells the lane to answer rather than repeat itself', () => {
  const block = formatCodexSideNoteHandover([
    { at: '2026-08-24T07:00:00.000Z', text: 'back in five, keep going' },
  ]);
  assert.match(block, /reached you mid-turn/);
  assert.match(block, /1 note\b/);
  assert.match(block, /rather than repeating yourself/);
  assert.match(block, /back in five, keep going/);
  assert.equal(formatCodexSideNoteHandover([]), '');
});

test('delivery only happens when exactly one lane is busy', () => {
  const lane = freshLane();
  // Nobody home — the message must take the normal queued path.
  assert.equal(deliverSideNoteToBusyCodexLane(new Set(), 'hello'), false);
  // Two lanes running: there is no way to know which room the owner is in, and the
  // wrong companion is worse than waiting.
  assert.equal(deliverSideNoteToBusyCodexLane(new Set([lane, 'other-lane']), 'hello'), false);
  assert.equal(deliverSideNoteToBusyCodexLane(new Set([lane]), 'hello'), true);
  assert.deepEqual(readCodexSideNotesFrom(lane, 0).notes.map((n) => n.text), ['hello']);
});
