// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// forEachLine hands over exactly the lines a split would, without ever holding
// the whole file, including a character cut in half by a chunk boundary.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forEachLine } from './transcript-lines.js';

async function linesOf(text: string): Promise<string[]> {
  const dir = mkdtempSync(join(tmpdir(), 'transcript-lines-'));
  try {
    const path = join(dir, 'file.jsonl');
    writeFileSync(path, text);
    const seen: string[] = [];
    await forEachLine(path, (line) => seen.push(line));
    return seen;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('every line, empty ones included, and nothing after a final newline', async () => {
  assert.deepEqual(await linesOf('a\n\nb\n'), ['a', '', 'b']);
});

test('a last line with no newline after it is still handed over', async () => {
  assert.deepEqual(await linesOf('a\nb'), ['a', 'b']);
});

test('a character split across two chunks arrives whole', async () => {
  // The stream reads 64 KiB at a time; the fire emoji's four bytes straddle the first boundary.
  const first = 'x'.repeat(64 * 1024 - 2) + '🔥';
  const second = 'y'.repeat(70_000) + 'é';
  assert.deepEqual(await linesOf(`${first}\n${second}\n`), [first, second]);
});

test('a missing file rejects rather than reading as empty', async () => {
  await assert.rejects(forEachLine(join(tmpdir(), 'no-such-transcript-anywhere.jsonl'), () => {}));
});
