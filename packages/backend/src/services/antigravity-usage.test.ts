// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseUsage } from './antigravity-usage.js';

// Verbatim from the real CLI on a live account, Sep 13 2026.
const REAL = [
  'Gemini Models\tWeekly Limit Remaining\t100%\t2026-09-20T19:41:19Z',
  'Gemini Models\tFive Hour Limit Remaining\t100%\t2026-09-14T00:41:19Z',
  'Claude and GPT models\tWeekly Limit Remaining\t100%\t2026-09-20T19:53:15Z',
  'Claude and GPT models\tFive Hour Limit Remaining\t100%\t2026-09-14T00:53:15Z',
].join('\n');

test('the real output reads as four limits across two groups', () => {
  const limits = parseUsage(REAL);
  assert.equal(limits.length, 4);
  assert.deepEqual([...new Set(limits.map((l) => l.group))], ['Gemini Models', 'Claude and GPT models']);
  assert.equal(limits[0].label, 'Weekly Limit Remaining');
  assert.equal(limits[0].remainingPercent, 100);
  assert.equal(limits[0].resetsAt, '2026-09-20T19:41:19Z');
});

test('a fractional percent survives — a real screen showed 99.97', () => {
  const [l] = parseUsage('Gemini Models\tWeekly Limit Remaining\t99.97%\t2026-09-20T19:41:19Z');
  assert.equal(l.remainingPercent, 99.97);
});

test('A ROW IT CANNOT READ IS DROPPED, NEVER GUESSED AT', () => {
  const junk = [
    'Gemini Models\tWeekly Limit Remaining\tunknown\t2026-09-20T19:41:19Z',
    'Gemini Models\tFive Hour Limit Remaining\t\t2026-09-14T00:41:19Z',
    'some banner line with no tabs at all',
    'Gemini Models\tFive Hour Limit Remaining\t42%\t2026-09-14T00:41:19Z',
  ].join('\n');
  const limits = parseUsage(junk);
  assert.equal(limits.length, 1, 'only the readable row survives');
  assert.equal(limits[0].remainingPercent, 42);
});

test('a missing or unparseable reset stamp is null rather than invented', () => {
  const [a] = parseUsage('Gemini Models\tWeekly Limit Remaining\t50%\tnot-a-date');
  assert.equal(a.resetsAt, null);
  const [b] = parseUsage('Gemini Models\tWeekly Limit Remaining\t50%');
  assert.equal(b.resetsAt, null);
  assert.equal(b.remainingPercent, 50);
});

test('empty output yields nothing rather than a zero reading', () => {
  assert.deepEqual(parseUsage(''), []);
  assert.deepEqual(parseUsage('\n\n'), []);
});
