// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// THE CHECKS ON THE OWNER'S MESSAGES MEAN A COMPANION READ THEM.
//
// Two things used to tick the owner's messages off with nobody reading them:
// the house stamped each one read the instant it arrived, and the owner
// reading the companions' replies stamped everything above them read, the
// owner's own messages included. So a side note showed two checks before any
// companion had seen it. These hold the new rules: the owner's reading touches
// only companion rows, and the owner's rows are stamped only by
// markOwnMessagesRead, once a companion is handed them.

const { initDb, getDb } = await import('./db/init.js');
initDb(':memory:');
const { createThread, createMessage, markMessagesRead, markOwnMessagesRead } = await import('./db.js');
const { sideNotesCoveredBy } = await import('./heartbeat/supervisor.js');
const { ownMessagesRead } = await import('./own-messages-read.js');
const { registry } = await import('./ws/connection-registry.js');

const now = '2026-03-15T06:00:00.000Z';
createThread({ id: 'home', name: 'Home', type: 'named', createdAt: now, sessionType: 'v2' });
createThread({ id: 'second', name: 'Second', type: 'named', createdAt: now, sessionType: 'v2' });
let n = 0;
function say(threadId: string, role: 'user' | 'companion' | 'system', id = `m${++n}`) {
  return createMessage({ id, threadId, role, content: `${role} ${id}`, contentType: 'text', createdAt: now });
}
const readAt = (id: string) => (getDb().prepare('SELECT read_at FROM messages WHERE id = ?').get(id) as { read_at: string | null }).read_at;

test('the owner reading the room ticks off companion messages and leaves the owner\'s alone', () => {
  const owners = say('home', 'user');
  const companions = say('home', 'companion');
  markMessagesRead('home', companions.id, now);
  assert.equal(readAt(companions.id), now, 'the companion message is read once the owner has seen it');
  assert.equal(readAt(owners.id), null, 'the owner\'s waits for a companion');
});

test('the owner\'s message is stamped once, only the owner\'s, and a guest\'s is never ticked', () => {
  const owners = say('home', 'user');
  const guest = say('home', 'system');
  const changed = markOwnMessagesRead([owners.id, guest.id, owners.id, 'nobody'], now);
  assert.deepEqual(changed, [{ id: owners.id, thread_id: 'home' }]);
  assert.equal(readAt(owners.id), now);
  assert.equal(readAt(guest.id), null);
  assert.deepEqual(markOwnMessagesRead([owners.id], '2026-03-15T07:00:00.000Z'), [], 'a second stamp changes nothing');
  assert.equal(readAt(owners.id), now, 'and keeps the first time');
});

test('the phone hears one message_read per thread, naming only what changed', () => {
  const a = say('home', 'user');
  const b = say('second', 'user');
  const already = say('home', 'user');
  markOwnMessagesRead([already.id], now);
  const heard: any[] = [];
  const original = registry.broadcast.bind(registry);
  (registry as any).broadcast = (msg: unknown) => { heard.push(msg); };
  try {
    ownMessagesRead([a.id, b.id, already.id, undefined, null, '']);
  } finally {
    (registry as any).broadcast = original;
  }
  const byThread = Object.fromEntries(heard.map((m) => [m.threadId, m]));
  assert.equal(heard.length, 2);
  assert.equal(byThread.home.type, 'message_read');
  assert.deepEqual(byThread.home.messageIds, [a.id]);
  assert.deepEqual(byThread.second.messageIds, [b.id]);
  assert.equal(typeof byThread.home.readAt, 'string');
});

test("a side note counts as read once the lane's mark reaches it, and not before", () => {
  const notes = [
    { at: '2026-03-15T06:04:32.286Z', messageId: 'early' },
    { at: '2026-03-15T06:08:16.121Z', messageId: 'marked' },
    { at: '2026-03-15T06:09:00.000Z', messageId: 'later' },
    { at: '2026-03-15T06:01:00.000Z' },
  ];
  assert.deepEqual(sideNotesCoveredBy(notes, '2026-03-15T06:08:16.121Z'), ['early', 'marked']);
  assert.deepEqual(sideNotesCoveredBy(notes, ''), [], 'no mark, nothing read');
});
