// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileBornAt } from './files.js';

// After a move to a new server, a whole library of pictures read as the day of
// the move in Files. A copy that keeps the modified time gives a file a new
// birth time and its old modified time, so the earlier of the two is when it
// was made.
test('a copied file keeps the date it was made, not the date it moved', () => {
  const made = Date.parse('2026-06-22T08:04:02.389Z');
  const moved = Date.parse('2026-07-04T05:40:27.977Z');
  assert.strictEqual(fileBornAt({ birthtimeMs: moved, mtimeMs: made }), '2026-06-22T08:04:02.389Z');
});

test('a file edited after it was made keeps the day it was made', () => {
  const made = Date.parse('2026-09-23T10:00:00.000Z');
  const edited = Date.parse('2026-09-24T02:00:00.000Z');
  assert.strictEqual(fileBornAt({ birthtimeMs: made, mtimeMs: edited }), '2026-09-23T10:00:00.000Z');
});

test('a filesystem with no birth time reports zero, and zero is not a date', () => {
  const made = Date.parse('2026-08-01T00:00:00.000Z');
  assert.strictEqual(fileBornAt({ birthtimeMs: 0, mtimeMs: made }), '2026-08-01T00:00:00.000Z');
});

test('the file list dates every entry by it', () => {
  const src = readFileSync(new URL('./files.ts', import.meta.url), 'utf8');
  assert.match(src, /createdAt: fileBornAt\(stat\)/);
});
