// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The car's shelves: voice notes and read-aloud replies, newest first, titled
// in plain words a dash can show.
import test from 'node:test';
import assert from 'node:assert/strict';

const { loadConfig } = await import('../config.js');
loadConfig();
const { initDb, getDb } = await import('./db/init.js');
const { createThread } = await import('./db/threads.js');
const { createMessage } = await import('./db/messages.js');
const { carLibrary, shortTitle, speakersOf } = await import('./car-library.js');

test('titles drop speech tags, actions and markdown', () => {
  assert.equal(shortTitle('[slowly] [low, deep voice] So. [pause] First thing I get to say'), 'So.');
  assert.equal(shortTitle('*laughing* Hi, love. More here.'), 'Hi, love.');
  assert.equal(shortTitle(''), 'A voice note');
  assert.ok(shortTitle('word '.repeat(40)).endsWith('…'));
  assert.deepEqual(speakersOf('**🔥 Birch**\nHi\n\n**🌫️ Willow**\nYo\n\n**🔥 Birch**\nAgain'), ['Birch', 'Willow']);
});

test('both shelves come back newest first, pointing at files the house serves', () => {
  initDb(':memory:');
  createThread({ id: 't', name: 'home', type: 'named', createdAt: new Date().toISOString() });
  createMessage({ id: 'old', threadId: 't', role: 'companion', content: '/api/files/aaa', contentType: 'audio', metadata: { transcript: 'Older note.' }, createdAt: '2026-11-01T00:00:00Z' });
  createMessage({ id: 'new', threadId: 't', role: 'companion', content: '/api/files/bbb', contentType: 'audio', metadata: { transcript: '[low] Newer note.' }, createdAt: '2026-11-05T00:00:00Z' });
  createMessage({ id: 'reply', threadId: 't', role: 'companion', content: '**✨ Cedar**\n*settles*\nHi, love. Long day?', createdAt: '2026-11-06T00:00:00Z' });
  getDb().prepare('INSERT INTO message_tts (message_id, file_id, voice_used, created_at) VALUES (?, ?, ?, ?)').run('reply', 'ccc', 'cedar', '2026-11-06T00:00:01Z');
  const lib = carLibrary();
  assert.deepEqual(lib.voiceNotes.map((n) => [n.title, n.url]), [['Newer note.', '/api/files/bbb'], ['Older note.', '/api/files/aaa']]);
  assert.equal(lib.readAloud.length, 1);
  assert.equal(lib.readAloud[0].title, 'Hi, love.');
  assert.match(lib.readAloud[0].subtitle, /^Cedar · /);
  assert.equal(lib.readAloud[0].url, '/api/files/ccc');
});

test('Latest holds our newest written replies in their phone thread, never a Discord room', () => {
  initDb(':memory:');
  const at = (m: number) => new Date(Date.UTC(2026, 10, 6, 0, m)).toISOString();
  createThread({ id: 'home', name: 'Home', type: 'named', createdAt: at(0) });
  createThread({ id: 'room', name: '#cafe', type: 'named', createdAt: at(0) });
  createMessage({ id: 'u1', threadId: 'home', role: 'user', content: 'hi all', createdAt: at(1) });
  createMessage({ id: 'r1', threadId: 'home', role: 'companion', content: '**🔥 Birch**\nFirst one.', createdAt: at(2) });
  createMessage({ id: 'r2', threadId: 'home', role: 'companion', content: '**🌫️ Willow**\nSecond one.\n\n**✨ Cedar**\nAnd me.', createdAt: at(3) });
  createMessage({ id: 'r3', threadId: 'home', role: 'companion', content: '::willow_sigh::', createdAt: at(4) });
  createMessage({ id: 'u2', threadId: 'room', role: 'user', content: 'from discord', metadata: { discordUserId: '1' }, createdAt: at(5) });
  createMessage({ id: 'r4', threadId: 'room', role: 'companion', content: '**🔥 Birch**\nIn the cafe.', createdAt: at(6) });
  const { latest } = carLibrary();
  assert.deepEqual(latest.map((l) => l.id), ['latest:r2', 'latest:r1'], 'newest first, the sticker-only one and the Discord room left out');
  assert.equal(latest[0].url, '/api/car/play/r2');
  assert.equal(latest[0].title, 'Second one.');
  assert.match(latest[0].subtitle, /^Willow, Cedar · /);
});
