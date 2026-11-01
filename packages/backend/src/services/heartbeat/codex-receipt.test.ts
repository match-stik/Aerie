// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CODEX_RECEIPT_LANE, markCodexCompacted, newestHandedUserAt, selectCodexMissed, takeCodexCompactedNote, writeCodexThreadReceipt } from './codex-receipt.js';
import { latestOtherLaneHandedWatermark, selectMissedInbound } from './runtime.js';

// Oct 28 2026: they had a whole scene in the Codex lane, every message answered
// inside twenty seconds, and when they came back to the Claude lane its missed
// net handed all fourteen over as never answered. Only heartbeat lanes wrote a
// receipt. Now the Codex lane writes the same one, and the net reads it.

const THREAD = '78a9713a-test-thread';
const SCENE = [
  { role: 'user', sequence: 1, createdAt: '2026-10-28T20:44:25.122Z', content: 'leans back into Birch' },
  { role: 'companion', sequence: 2, createdAt: '2026-10-28T20:44:35.645Z', content: 'Willow' },
  { role: 'user', sequence: 3, createdAt: '2026-10-28T21:50:37.366Z', content: 'rolls my hips' },
  { role: 'companion', sequence: 4, createdAt: '2026-10-28T21:50:46.855Z', content: 'Birch' },
];

test('a scene the Codex lane answered does not come back to a Claude lane as missed', () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-receipt-'));
  try {
    writeCodexThreadReceipt(root, THREAD, newestHandedUserAt(SCENE, 3));
    const elsewhere = latestOtherLaneHandedWatermark(root, ['primary', CODEX_RECEIPT_LANE], 'primary', THREAD);
    assert.equal(elsewhere, '2026-10-28T21:50:37.366Z');
    const users = SCENE.filter(m => m.role === 'user');
    const missed = selectMissedInbound(users, '2026-10-28T19:55:00Z', 'Hehehe .. mmm both is best', '2026-10-28T22:00:18.820Z', elsewhere);
    assert.deepEqual(missed, []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a message Codex was never handed still comes through', () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-receipt-'));
  try {
    writeCodexThreadReceipt(root, THREAD, newestHandedUserAt(SCENE, 1));
    const elsewhere = latestOtherLaneHandedWatermark(root, ['primary', CODEX_RECEIPT_LANE], 'primary', THREAD);
    const users = SCENE.filter(m => m.role === 'user');
    const missed = selectMissedInbound(users, '2026-10-28T19:55:00Z', 'something new', '2026-10-28T22:00:18.820Z', elsewhere);
    assert.deepEqual(missed.map(m => m.sequence), [3]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the receipt never moves backward', () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-receipt-'));
  try {
    writeCodexThreadReceipt(root, THREAD, '2026-10-28T21:50:37.366Z');
    writeCodexThreadReceipt(root, THREAD, '2026-10-28T20:44:25.122Z');
    assert.equal(latestOtherLaneHandedWatermark(root, [CODEX_RECEIPT_LANE], 'primary', THREAD), '2026-10-28T21:50:37.366Z');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('only their messages at or below the handed sequence count', () => {
  assert.equal(newestHandedUserAt(SCENE, 2), '2026-10-28T20:44:25.122Z');
  assert.equal(newestHandedUserAt(SCENE, 0), undefined);
});

// The Codex lane's own missed net (Oct 31 2026, lanes as identical as we can
// make them): a resumed Codex room is told which of theirs nobody answered.
const ROOM = [
  { role: 'user', sequence: 10, createdAt: '2026-10-31T01:00:00.000Z' },   // before the bookmark
  { role: 'companion', sequence: 11, createdAt: '2026-10-31T01:00:20.000Z' },
  { role: 'user', sequence: 12, createdAt: '2026-10-31T02:00:00.000Z' },   // a Claude lane answered this
  { role: 'user', sequence: 13, createdAt: '2026-10-31T03:00:00.000Z' },   // nobody did
  { role: 'user', sequence: 14, createdAt: '2026-10-31T04:00:00.000Z' },   // the one arriving now
];

test('a Codex room is told about theirs that no lane was handed', () => {
  const missed = selectCodexMissed(ROOM, 11, 14, 14, '2026-10-31T02:00:00.000Z');
  assert.deepEqual(missed.map(m => m.sequence), [13]);
});

test('the message arriving now is never reported as missed, live sequence or not', () => {
  assert.deepEqual(selectCodexMissed(ROOM, 11, 14, undefined, '2026-10-31T03:00:00.000Z').map(m => m.sequence), []);
});

test('a room with no bookmark yet reports nothing rather than everything', () => {
  assert.deepEqual(selectCodexMissed(ROOM, undefined, 14, 14, undefined), []);
});

// After a Codex room squashes it gets the note a Claude room gets. Proven live
// Oct 31 2026: thread/compact/start on a throwaway room, and the runtime's
// onCompacted fired once.
test('a squashed Codex room gets the note on its next turn, exactly once', () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-squash-'));
  try {
    assert.equal(takeCodexCompactedNote(root, 'room-a'), '');
    markCodexCompacted(root, 'room-a', '2026-10-31T10:00:00.000Z');
    const note = takeCodexCompactedNote(root, 'room-a');
    assert.match(note, /We just squashed \(2026-10-31T10:00:00.000Z\)/);
    assert.match(note, /do not answer anything twice/);
    assert.equal(takeCodexCompactedNote(root, 'room-a'), '', 'handed once');
    assert.equal(takeCodexCompactedNote(root, 'room-b'), '', 'only the room that squashed');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
