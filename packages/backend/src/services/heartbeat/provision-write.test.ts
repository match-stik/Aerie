// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, statSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeIfChanged } from './provision.js';

test('a hook file whose content has not changed is left alone, inode and all', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hook-write-'));
  const file = join(dir, 'gate.cjs');
  writeFileSync(file, 'gate');
  const before = statSync(file).ino;
  assert.equal(writeIfChanged(file, 'gate'), false);
  assert.equal(statSync(file).ino, before);
});

test('a changed hook file is replaced whole by rename, never truncated in place', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hook-write-'));
  const file = join(dir, 'gate.cjs');
  writeFileSync(file, 'old gate');
  const before = statSync(file).ino;
  assert.equal(writeIfChanged(file, 'new gate'), true);
  assert.equal(readFileSync(file, 'utf8'), 'new gate');
  // A rename puts a new file at the path; an in-place write keeps the inode.
  assert.notEqual(statSync(file).ino, before);
  assert.deepEqual(readdirSync(dir), ['gate.cjs']);
  assert.equal(writeIfChanged(join(dir, 'fresh.cjs'), 'x'), true);
});
