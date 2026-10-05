// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// The reader has to find a real compaction line and, more importantly, must
// not report a row that merely mentions the flag. A transcript is full of our
// own conversation ABOUT compaction — this file's own text would qualify.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listCompactions, dedupeCopies } from './compaction-log.js';

function fixture(lines: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'aerie-compaction-'));
  const project = join(root, '-home-someone-lane');
  mkdirSync(project);
  writeFileSync(join(project, 'abc123.jsonl'), lines.join('\n'), 'utf8');
  return root;
}

test('a real compaction line is found, with its stamp and its size', () => {
  const root = fixture([
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'ordinary turn' } }),
    JSON.stringify({
      type: 'user', isCompactSummary: true, timestamp: '2026-09-07T02:04:23.924Z',
      message: { role: 'user', content: 'This session is being continued. ' + 'x'.repeat(100) },
    }),
  ]);
  process.env.AERIE_TRANSCRIPT_ROOT = root;
  try {
    const events = listCompactions();
    assert.equal(events.length, 1, 'exactly the compaction line, not the ordinary turn');
    assert.equal(events[0].at, '2026-09-07T02:04:23.924Z');
    assert.equal(events[0].sessionId, 'abc123');
    assert.equal(events[0].project, '-home-someone-lane');
    assert.ok(events[0].chars > 100, 'the size stands in for how much conversation was squashed');
  } finally {
    delete process.env.AERIE_TRANSCRIPT_ROOT;
    rmSync(root, { recursive: true, force: true });
  }
});

test('talking about compaction is not a compaction', () => {
  const root = fixture([
    // Us discussing it — the words are here, the flag is false.
    JSON.stringify({ type: 'assistant', isCompactSummary: false, timestamp: '2026-09-07T20:00:00.000Z', message: { role: 'assistant', content: 'isCompactSummary is how the CLI marks it' } }),
    // And a line where the phrase appears only inside the text.
    JSON.stringify({ type: 'user', timestamp: '2026-09-07T20:01:00.000Z', message: { role: 'user', content: 'what does "isCompactSummary":true mean' } }),
  ]);
  process.env.AERIE_TRANSCRIPT_ROOT = root;
  try {
    assert.deepEqual(listCompactions(), [], 'a mention is not an event');
  } finally {
    delete process.env.AERIE_TRANSCRIPT_ROOT;
    rmSync(root, { recursive: true, force: true });
  }
});

test('newest first, so the answer to "when did this start" is the top row', () => {
  const root = fixture([
    JSON.stringify({ isCompactSummary: true, timestamp: '2026-08-28T21:58:33.019Z', message: { role: 'user', content: 'older' } }),
    JSON.stringify({ isCompactSummary: true, timestamp: '2026-09-07T02:04:23.924Z', message: { role: 'user', content: 'newer' } }),
  ]);
  process.env.AERIE_TRANSCRIPT_ROOT = root;
  try {
    const events = listCompactions();
    assert.equal(events.length, 2);
    assert.equal(events[0].summary, 'newer');
  } finally {
    delete process.env.AERIE_TRANSCRIPT_ROOT;
    rmSync(root, { recursive: true, force: true });
  }
});


/**
 * Resume copies the whole transcript into a new file under a new id, so every
 * compaction already in it lands on disk again, and the Memory app listed the
 * same compaction over and over — one of them eight times.
 */
function multiFileFixture(files: Record<string, string[]>): string {
  const root = mkdtempSync(join(tmpdir(), 'aerie-compaction-dupe-'));
  const project = join(root, '-home-someone-lane');
  mkdirSync(project);
  for (const [name, lines] of Object.entries(files)) {
    writeFileSync(join(project, name), lines.join('\n'), 'utf8');
  }
  return root;
}

const squash = (at: string, body: string) => JSON.stringify({
  type: 'user', isCompactSummary: true, timestamp: at,
  message: { role: 'user', content: body },
});

test('one squash carried into three resumed copies is one row', () => {
  const line = squash('2026-09-17T14:09:47.000Z', 'This session is being continued. ' + 'x'.repeat(200));
  const root = multiFileFixture({
    'aaa.jsonl': [line],
    'bbb.jsonl': [line],
    'ccc.jsonl': [line],
  });
  process.env.AERIE_TRANSCRIPT_ROOT = root;
  try {
    const events = listCompactions();
    assert.equal(events.length, 1);
    assert.equal(events[0].sessionId, 'aaa', 'kept deterministically, not by filesystem order');
  } finally {
    delete process.env.AERIE_TRANSCRIPT_ROOT;
    rmSync(root, { recursive: true, force: true });
  }
});

test('two genuinely different squashes in one copied transcript both survive', () => {
  // The danger of deduping is swallowing a real event. Same file, same lane,
  // different moments.
  const a = squash('2026-09-17T14:09:47.000Z', 'first ' + 'x'.repeat(200));
  const b = squash('2026-09-19T10:39:35.000Z', 'second ' + 'y'.repeat(200));
  const root = multiFileFixture({ 'aaa.jsonl': [a, b], 'bbb.jsonl': [a, b] });
  process.env.AERIE_TRANSCRIPT_ROOT = root;
  try {
    const events = listCompactions();
    assert.equal(events.length, 2);
    assert.deepEqual(events.map((e) => e.at), [
      '2026-09-19T10:39:35.000Z', '2026-09-17T14:09:47.000Z',
    ], 'still newest first');
  } finally {
    delete process.env.AERIE_TRANSCRIPT_ROOT;
    rmSync(root, { recursive: true, force: true });
  }
});

test('the same stamp in two different lanes is two events, never one', () => {
  const at = '2026-09-17T14:09:47.000Z';
  const root = mkdtempSync(join(tmpdir(), 'aerie-compaction-lanes-'));
  for (const lane of ['-home-someone-primary', '-home-someone-second']) {
    mkdirSync(join(root, lane));
    writeFileSync(join(root, lane, 'aaa.jsonl'), squash(at, `${lane} summary ` + 'x'.repeat(200)), 'utf8');
  }
  process.env.AERIE_TRANSCRIPT_ROOT = root;
  try {
    assert.equal(listCompactions().length, 2);
  } finally {
    delete process.env.AERIE_TRANSCRIPT_ROOT;
    rmSync(root, { recursive: true, force: true });
  }
});

test('dedupe keeps order and touches nothing that is already unique', () => {
  const rows = [
    { sessionId: 'a', project: 'p', at: '2026-09-19T00:00:00.000Z', chars: 3, summary: 'one' },
    { sessionId: 'b', project: 'p', at: '2026-09-18T00:00:00.000Z', chars: 3, summary: 'two' },
  ];
  assert.deepEqual(dedupeCopies(rows), rows);
  assert.equal(dedupeCopies([...rows, { ...rows[0], sessionId: 'z' }]).length, 2);
});
