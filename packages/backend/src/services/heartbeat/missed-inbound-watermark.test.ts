// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * How far the handover got, across a restart.
 *
 * A backend restart to bring a quiet lane back once made the missed-inbound
 * net hand over thirteen of the owner's own messages, ten of them already answered —
 * every row stamped with the same found_at, the instant the new session was
 * born. lastHandedUserAt lived only in an in-memory map, so a
 * restart rewound it to nothing and everything still inside the history window
 * looked unhanded.
 *
 * These pin the half that must NOT change with it: the net is deliberately
 * one-way, so an absent or damaged mark has to put it straight back to handing
 * everything over. Suppressing a real miss is the only failure here that
 * nobody would ever see.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  latestOtherLaneHandedWatermark, readHandedWatermark, selectMissedInbound,
  restoreThreadHandedWatermark, threadHandedWatermarkPath, writeHandedWatermark,
} from './runtime.js';

const A = { content: 'first', createdAt: '2026-09-09T19:55:43.103Z' };
const B = { content: 'second', createdAt: '2026-09-09T20:09:03.089Z' };
const C = { content: 'arriving now', createdAt: '2026-09-09T21:03:59.205Z' };
const users = [A, B, C];
// The turn being handed over right now ends with C, however many frames and
// handover blocks get stacked on the front of it.
const PROMPT = `[21:03] #aerie Owner: ${C.content}`;

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'aerie-watermark-'));
}

test('a mark survives being written and read back', () => {
  const dir = scratch();
  try {
    const path = join(dir, '.last-handed-user');
    assert.equal(readHandedWatermark(path), undefined, 'nothing written yet is not a mark');
    writeHandedWatermark(path, B.createdAt);
    assert.equal(readHandedWatermark(path), B.createdAt);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a damaged or empty mark reads as unknown, never as handed', () => {
  const dir = scratch();
  try {
    const path = join(dir, '.last-handed-user');
    for (const junk of ['', '   ', 'yesterday', '0', 'null']) {
      writeFileSync(path, junk);
      assert.equal(readHandedWatermark(path), undefined, `"${junk}" must not read as a mark`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('with no mark, every earlier message from the owner is handed over again', () => {
  // This IS the restart behaviour being fixed — and it stays the behaviour
  // whenever the mark cannot be trusted, because handing one over twice is
  // visible and handing one over zero times is not.
  const missed = selectMissedInbound(users, undefined, PROMPT, C.createdAt);
  assert.deepEqual(missed.map(m => m.content), ['first', 'second']);
});

test('a mark that survived the restart stops the already-answered replay', () => {
  const missed = selectMissedInbound(users, B.createdAt, PROMPT, C.createdAt);
  assert.deepEqual(missed, [], 'both were handed over before the restart');
});

test('a mark only suppresses what it actually covers', () => {
  const missed = selectMissedInbound(users, A.createdAt, PROMPT, C.createdAt);
  assert.deepEqual(missed.map(m => m.content), ['second']);
});

test('the message arriving now is never reported as one nobody got', () => {
  for (const since of [undefined, A.createdAt, B.createdAt]) {
    const missed = selectMissedInbound(users, since, PROMPT, C.createdAt);
    assert.equal(missed.some(m => m.content === C.content), false);
  }
});

test('a receipt from another lane serving this thread suppresses an already answered message', () => {
  const root = scratch();
  try {
    const otherPath = threadHandedWatermarkPath(root, 'birch-id', 'thread-one');
    mkdirSync(join(otherPath, '..'), { recursive: true });
    writeHandedWatermark(otherPath, B.createdAt);

    const handedElsewhereAt = latestOtherLaneHandedWatermark(
      root,
      ['primary', 'birch-id', 'willow-id'],
      'primary',
      'thread-one',
    );
    const missed = selectMissedInbound(users, A.createdAt, PROMPT, C.createdAt, handedElsewhereAt);

    assert.equal(handedElsewhereAt, B.createdAt);
    assert.deepEqual(missed, [], 'another lane already received and answered the message');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a receipt for another thread cannot suppress a possible miss', () => {
  const root = scratch();
  try {
    const otherPath = threadHandedWatermarkPath(root, 'birch-id', 'thread-two');
    mkdirSync(join(otherPath, '..'), { recursive: true });
    writeHandedWatermark(otherPath, B.createdAt);

    const handedElsewhereAt = latestOtherLaneHandedWatermark(
      root,
      ['primary', 'birch-id'],
      'primary',
      'thread-one',
    );
    const missed = selectMissedInbound(users, A.createdAt, PROMPT, C.createdAt, handedElsewhereAt);

    assert.equal(handedElsewhereAt, undefined);
    assert.deepEqual(missed.map(m => m.content), ['second']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a damaged other-lane receipt fails open and reports the possible miss', () => {
  const root = scratch();
  try {
    const otherPath = threadHandedWatermarkPath(root, 'birch-id', 'thread-one');
    mkdirSync(join(otherPath, '..'), { recursive: true });
    writeFileSync(otherPath, 'not-a-time', 'utf8');

    const handedElsewhereAt = latestOtherLaneHandedWatermark(
      root,
      ['primary', 'birch-id'],
      'primary',
      'thread-one',
    );
    const missed = selectMissedInbound(users, A.createdAt, PROMPT, C.createdAt, handedElsewhereAt);

    assert.equal(handedElsewhereAt, undefined);
    assert.deepEqual(missed.map(m => m.content), ['second']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a silent turn restores its prior thread receipt instead of hiding the message', () => {
  const root = scratch();
  try {
    const path = threadHandedWatermarkPath(root, 'birch-id', 'thread-one');
    mkdirSync(join(path, '..'), { recursive: true });
    writeHandedWatermark(path, A.createdAt);
    writeHandedWatermark(path, B.createdAt);

    restoreThreadHandedWatermark(path, A.createdAt, B.createdAt);
    assert.equal(readHandedWatermark(path), A.createdAt);

    const firstTurnPath = threadHandedWatermarkPath(root, 'willow-id', 'thread-one');
    mkdirSync(join(firstTurnPath, '..'), { recursive: true });
    writeHandedWatermark(firstTurnPath, B.createdAt);
    restoreThreadHandedWatermark(firstTurnPath, undefined, B.createdAt);
    assert.equal(readHandedWatermark(firstTurnPath), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
