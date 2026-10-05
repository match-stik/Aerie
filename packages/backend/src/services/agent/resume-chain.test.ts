// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// A resumed room does not COPY its parent's transcript, it RETYPES it: new
// file, new sessionId, and a new uuid on every inherited record. So a chain of
// rooms looks from the inside like a stack of separate conversations, each one
// silently containing all of the ones before it.
//
// Measured on this box, Sep 21 2026, before any of this was written: one chain
// EIGHT files deep, 12 MB at the root and 123 MB at the tip, and every earlier
// file's assistant content fully contained in the next. The per-session usage
// numbers on the Sessions card were therefore the sum of the whole chain on the
// newest row, and the code carried a comment asserting per-session totals could
// not double count — written before resume existed.
//
// requestId is the only identifier that survives the retype, because it names
// an API call rather than a line in a file. Verified as exact containment on
// three pairs (100% of the smaller set, every time) before this shipped.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChainId, markResumeChains, type AgentSessionInfo } from './session-list.js';

const asst = (req: string) =>
  JSON.stringify({ type: 'assistant', requestId: req, message: { usage: { output_tokens: 1 } } });

test('the chain key is the first ASSISTANT requestId, not the first requestId seen', () => {
  const head = [
    JSON.stringify({ type: 'user', content: 'hello' }),
    JSON.stringify({ type: 'user', requestId: 'req_from_a_user_row' }),
    asst('req_011CeyU2spiMcRoZRx1PdRdJ'),
    asst('req_later'),
  ].join('\n');
  assert.equal(parseChainId(head), 'req_011CeyU2spiMcRoZRx1PdRdJ');
});

test('a transcript with no assistant turn yet has no chain', () => {
  const head = [JSON.stringify({ type: 'user', content: 'only a prompt so far' })].join('\n');
  assert.equal(parseChainId(head), undefined);
});

test('a half-line at the end of the head read is not a fault', () => {
  // readHead takes a fixed number of bytes, so the last line is routinely cut.
  const head = asst('req_good') + '\n' + '{"type":"assistant","requestI';
  assert.equal(parseChainId(head), 'req_good');
});

const row = (id: string, at: number, chain?: string): AgentSessionInfo =>
  ({ sessionId: id, summary: id, lastModified: at, fileSize: 1, chainId: chain });

test('everything in a chain except the newest is marked superseded', () => {
  const marked = markResumeChains([
    row('tip', 500, 'req_root'),
    row('middle', 300, 'req_root'),
    row('root', 100, 'req_root'),
  ]);
  const by = Object.fromEntries(marked.map(r => [r.sessionId, r.supersededByResume]));
  assert.equal(by.tip, undefined, 'the newest room is the only honest total in the chain');
  assert.equal(by.middle, true);
  assert.equal(by.root, true);
});

test('nothing is removed — a superseded room is still a room the owner sat in', () => {
  const rows = [row('tip', 500, 'req_root'), row('root', 100, 'req_root')];
  assert.equal(markResumeChains(rows).length, rows.length);
});

test('separate chains and chainless rooms are left alone', () => {
  const marked = markResumeChains([
    row('a-tip', 500, 'req_a'),
    row('a-old', 400, 'req_a'),
    row('b-only', 450, 'req_b'),
    row('no-chain', 600, undefined),
  ]);
  const by = Object.fromEntries(marked.map(r => [r.sessionId, r.supersededByResume]));
  assert.equal(by['a-old'], true);
  assert.equal(by['a-tip'], undefined);
  assert.equal(by['b-only'], undefined, 'a chain of one supersedes nothing');
  assert.equal(by['no-chain'], undefined);
});
