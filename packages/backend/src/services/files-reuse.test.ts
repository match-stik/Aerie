// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The same picture sent twice comes back as the copy already stored (a picture
// picked, lost to a refresh and picked again was stored twice, and the first
// copy became an orphan). Read against a folder of its own, never
// the house's file store.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findIdenticalFile } from './files.js';

const dir = mkdtempSync(join(tmpdir(), 'files-reuse-'));
const id = '11111111-2222-4333-8444-555555555555';
const picture = Buffer.from('the same picture, byte for byte');
writeFileSync(join(dir, `${id}.jpg`), picture);
writeFileSync(join(dir, `${id}.name`), 'image.jpg');

test('the same bytes find the stored copy', () => {
  assert.equal(findIdenticalFile(Buffer.from(picture), '.jpg', dir), id);
});

test('different bytes of the same size are a new file', () => {
  const other = Buffer.alloc(picture.length, 0x41);
  assert.equal(findIdenticalFile(other, '.jpg', dir), null);
});

test('the same bytes under another kind of file are a new file', () => {
  assert.equal(findIdenticalFile(Buffer.from(picture), '.png', dir), null);
});

test('a folder that does not exist finds nothing', () => {
  assert.equal(findIdenticalFile(picture, '.jpg', join(dir, 'missing')), null);
});
