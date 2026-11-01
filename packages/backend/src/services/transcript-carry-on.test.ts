// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The two transcript readers that run before every reply lands now carry on
// from where the last read stopped instead of walking the whole room from the
// top (Oct 29 2026: about 1.5 s each on a 191 MB transcript, which is why the
// note showed up and the bubble under it sat as dots). Carrying on must give
// exactly what a fresh read from the top would.
import assert from 'node:assert/strict';
import test from 'node:test';
import { appendFileSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forEachLineFrom } from './transcript-lines.js';

function reply(id: string, at: string, cacheRead: number, extra = ''): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: at,
    message: {
      id,
      model: 'claude-opus-5',
      usage: { input_tokens: 5, output_tokens: 10, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: 1 },
      content: [{ type: 'text', text: `x${extra}` }],
    },
  });
}

function tmp(name: string): string {
  return join(mkdtempSync(join(tmpdir(), 'aerie-carry-')), name);
}

test('forEachLineFrom hands over complete lines only and resumes at the byte after them', async () => {
  const file = tmp('t.jsonl');
  // Multi-byte text, so a byte offset and a character offset disagree.
  writeFileSync(file, 'héllo\nwörld\npartial');
  const seen: string[] = [];
  const end = await forEachLineFrom(file, 0, (l) => seen.push(l));
  assert.deepEqual(seen, ['héllo', 'wörld']);
  assert.equal(end, Buffer.byteLength('héllo\nwörld\n'));
  appendFileSync(file, ' line\nnext\n');
  const more: string[] = [];
  const end2 = await forEachLineFrom(file, end, (l) => more.push(l));
  assert.deepEqual(more, ['partial line', 'next']);
  assert.equal(end2, statSync(file).size);
});

test('the context meter, carried on, matches a fresh read of the same file', async () => {
  const { readSessionUsage } = await import('./agent/session-list.js');
  const file = tmp('s.jsonl');
  writeFileSync(file, [reply('a', '2026-10-29T01:00:00Z', 100), reply('a', '2026-10-29T01:00:00Z', 100), reply('b', '2026-10-29T01:01:00Z', 200)].join('\n') + '\n');
  let st = statSync(file);
  const first = await readSessionUsage(file, st.size, st.mtimeMs);
  assert.equal(first!.replies, 2);

  // The room grows: a later record of reply b (must not count again) and a new reply c.
  appendFileSync(file, [reply('b', '2026-10-29T01:01:00Z', 200, 'more'), reply('c', '2026-10-29T01:02:00Z', 300)].join('\n') + '\n');
  st = statSync(file);
  const carried = await readSessionUsage(file, st.size, st.mtimeMs + 1);

  const copy = tmp('copy.jsonl');
  writeFileSync(copy, (await import('node:fs')).readFileSync(file));
  const cst = statSync(copy);
  const fresh = await readSessionUsage(copy, cst.size, cst.mtimeMs);
  assert.deepEqual(carried, fresh);
  assert.equal(carried!.replies, 3);
  assert.equal(carried!.contextTokens, 5 + 300 + 1);
});

test('a turn counted from the last offset files only what is new, and an old reply never twice', async () => {
  const { usageSinceFile } = await import('./heartbeat/turn-usage.js');
  const file = tmp('u.jsonl');
  writeFileSync(file, [reply('a', '2026-10-29T01:00:00Z', 100), reply('b', '2026-10-29T01:01:00Z', 200)].join('\n') + '\n');
  const turn1 = await usageSinceFile(file, Date.parse('2026-10-29T00:59:00Z'));
  assert.equal(turn1!.requests, 2);

  // Next turn: a late record of b after the watermark, and a new reply c.
  appendFileSync(file, [reply('b', '2026-10-29T01:03:00Z', 200, 'late'), reply('c', '2026-10-29T01:04:00Z', 300)].join('\n') + '\n');
  const turn2 = await usageSinceFile(file, turn1!.newest!);
  assert.equal(turn2!.requests, 1, 'only c is new; b was filed last turn');
  assert.equal(turn2!.cacheReadTokens, 300);

  // A lower floor than last time cannot trust the carried offset: it starts over.
  const again = await usageSinceFile(file, Date.parse('2026-10-29T00:59:00Z'));
  assert.equal(again!.requests, 3);
});

test('a transcript that shrank or was replaced is read again from the top', async () => {
  const { usageSinceFile } = await import('./heartbeat/turn-usage.js');
  const file = tmp('r.jsonl');
  writeFileSync(file, [reply('a', '2026-10-29T01:00:00Z', 100), reply('b', '2026-10-29T01:01:00Z', 200)].join('\n') + '\n');
  await usageSinceFile(file, 0);
  writeFileSync(file, reply('z', '2026-10-29T02:00:00Z', 9) + '\n');
  const turn = await usageSinceFile(file, 0);
  assert.equal(turn!.requests, 1);
  assert.equal(turn!.cacheReadTokens, 9);
});
