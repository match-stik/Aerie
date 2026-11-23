// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keepThenDelete } from './cortex.js';

// The shelf's delete button: the house keeps a whole copy on its own
// disk before the shelf forgets a conversation, and deletes nothing it could
// not copy whole.

test('the whole conversation is kept, page by page, before it is deleted', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'keep-'));
  const pages: Record<number, Record<string, unknown>> = {
    0: { title: 'An old window', total_chars: 10, content: 'hello ', next_offset: 6 },
    6: { content: 'there', next_offset: null },
  };
  let deleted = false;
  const { keptAt } = await keepThenDelete('abc', async (o) => pages[o], async () => {
    assert.ok(existsSync(join(dir, 'abc.json')), 'the copy is on disk before the delete');
    deleted = true;
  }, dir);
  assert.ok(deleted);
  const kept = JSON.parse(readFileSync(keptAt, 'utf8'));
  assert.equal(kept.content, 'hello there');
  assert.equal(kept.title, 'An old window');
});

test('a conversation that cannot be read whole is not deleted', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'keep-'));
  let deleted = false;
  await assert.rejects(keepThenDelete('abc', async () => ({ total_chars: 100, content: 'short', next_offset: null }), async () => { deleted = true; }, dir), /not deleted/);
  await assert.rejects(keepThenDelete('abc', async () => ({ error: 'gone' }), async () => { deleted = true; }, dir), /not deleted/);
  assert.equal(deleted, false);
});
