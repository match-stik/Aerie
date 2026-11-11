// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { forgetModelListing, idsInFile, ListingError, parseModelsDoc, readContextWindow, readModelListing } from './claude-model-check.js';

const PAGE = [
  'Some words first.',
  '| Feature | Claude Fable 5.2 | Claude Opus 5.5 | Claude Haiku 5.5 |',
  '| :--- | :--- | :--- | :--- |',
  '| Claude API ID | `claude-fable-5-2` | `claude-opus-5-5` | `claude-haiku-5-5` |',
  '| [Context window](https://x/context) | 1M tokens | 1M tokens | 200K tokens |',
].join('\n');

test('the comparison table gives each stated id with its label and window', () => {
  assert.deepEqual(parseModelsDoc(PAGE), [
    { id: 'claude-fable-5-2', label: 'Claude Fable 5.2', contextLength: 1_000_000 },
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', contextLength: 1_000_000 },
    { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', contextLength: 200_000 },
  ]);
  assert.equal(readContextWindow('soon'), null);
});

test('a page without the table is a changed page, never nothing new', async () => {
  assert.equal(parseModelsDoc('# Models\nNo table here.'), null);
  forgetModelListing();
  await assert.rejects(readModelListing(async () => '# Models'), ListingError);
  forgetModelListing();
  await assert.rejects(readModelListing(async () => { throw new Error('offline'); }), ListingError);
});

test('an id is found in the program only whole, even across a read boundary', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cmc-'));
  const file = join(dir, 'prog');
  // claude-fable-5 appears only inside claude-fable-5-1, so it must not count.
  const filler = Buffer.alloc(4 * 1024 * 1024 - 5, 0x20);
  writeFileSync(file, Buffer.concat([filler, Buffer.from('"claude-fable-5-1" x "claude-opus-5-5"')]));
  const found = await idsInFile(file, ['claude-fable-5', 'claude-fable-5-1', 'claude-opus-5-5', 'claude-fable-5-2']);
  assert.deepEqual([...found].sort(), ['claude-fable-5-1', 'claude-opus-5-5']);
});
