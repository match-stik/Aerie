// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// A search hit in the treehouse opens the Treehouse page around that message
// (theirs, Oct 31 2026), and the oldest rows, which name their author only in
// companion_id, still say who spoke.
import test from 'node:test';
import assert from 'node:assert/strict';
const { initDb } = await import('./db/init.js');
const { getDb } = await import('./db.js');
const { createMessage } = await import('./db/messages.js');
const { getTreehouseThread, getTreehouseMessages } = await import('./treehouse.js');
initDb(':memory:');

const thread = getTreehouseThread();
for (let i = 1; i <= 30; i++) {
  createMessage({ id: `m${i}`, threadId: thread.id, role: 'companion', content: `line ${i}`, contentType: 'text', platform: 'web', createdAt: new Date(Date.UTC(2026, 4, 1, 0, i)).toISOString() } as never);
}
getDb().prepare('UPDATE messages SET companion_id = ? WHERE id = ?').run('willow', 'm15');

test('around gives that many either side of the hit, oldest first, with the hit in it', () => {
  const rows = getTreehouseMessages(3, undefined, 'm15');
  assert.deepEqual(rows.map((r) => r.id), ['m12', 'm13', 'm14', 'm15', 'm16', 'm17', 'm18']);
});

test('around a message that is not in the treehouse gives nothing', () => {
  assert.deepEqual(getTreehouseMessages(3, undefined, 'nope'), []);
});

test('a row that names its author only in companion_id still has one', () => {
  const rows = getTreehouseMessages(0, undefined, 'm15');
  assert.equal(rows[0].companion_slug, 'willow');
});
