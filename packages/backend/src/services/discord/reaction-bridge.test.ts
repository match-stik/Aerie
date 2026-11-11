// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Reactions on our Discord replies, carried home: a reply learns the Discord
// ids it became, a reaction on one of them lands on that bubble under the
// reactor's own name, and nothing lands anywhere it does not belong.
import test from 'node:test';
import assert from 'node:assert/strict';

const { loadConfig } = await import('../../config.js');
loadConfig();

const { initDb } = await import('../db/init.js');
const { createThread } = await import('../db/threads.js');
const { createMessage, getMessage } = await import('../db/messages.js');
const { discordEmojiString, findReplyRow, recordSentDiscordIds, findRowByDiscordId, carryDiscordReaction } = await import('./reaction-bridge.js');

const THREAD = 'thread-home';

function freshHouse(): void {
  initDb(':memory:');
  createThread({ id: THREAD, name: 'home', type: 'named', createdAt: new Date().toISOString() });
}

let n = 0;
function store(role: 'companion' | 'user', content: string, platform: 'discord' | 'web' = 'discord'): string {
  const id = `m${++n}`;
  createMessage({ id, threadId: THREAD, role, content, platform, createdAt: new Date().toISOString() });
  return id;
}

function reactionsOn(id: string): Array<{ emoji: string; user: string; name?: string }> {
  const meta = getMessage(id)?.metadata as { reactions?: Array<{ emoji: string; user: string; name?: string }> } | null | undefined;
  return meta?.reactions ?? [];
}

test('an emoji is written as itself, a server emote as Discord writes it', () => {
  assert.equal(discordEmojiString({ id: null, name: '❤️' }), '❤️');
  assert.equal(discordEmojiString({ id: '123', name: 'melt', animated: false }), '<:melt:123>');
  assert.equal(discordEmojiString({ id: '456', name: 'Pffft', animated: true }), '<a:Pffft:456>');
  assert.equal(discordEmojiString({ id: null, name: null }), null);
});

test('a sent reply is tied to the stored row with the same words, and only that one', () => {
  freshHouse();
  const older = store('companion', '**🔥 Birch**\nSame words, older.');
  const ack = store('companion', '**🌫️ Willow**\nOn it, love.');
  const reply = store('companion', '**🌫️ Willow**\nThe answer that went to the room.');
  store('user', 'their own message');
  assert.equal(findReplyRow(THREAD, '  **🌫️ Willow**\nThe answer that went to the room.\n'), reply);
  assert.equal(findReplyRow(THREAD, 'words nobody stored'), null, 'no match means no guess');
  assert.equal(recordSentDiscordIds(THREAD, '**🌫️ Willow**\nThe answer that went to the room.', 'chan', ['111', '222']), reply);
  assert.deepEqual((getMessage(reply)?.metadata as { discordSentIds: string[] }).discordSentIds, ['111', '222']);
  assert.equal(getMessage(ack)?.metadata ?? null, null, 'the ack that never reached the room is left alone');
  assert.equal(getMessage(older)?.metadata ?? null, null);
  assert.equal(findRowByDiscordId('222'), reply);
  assert.equal(findRowByDiscordId('22'), null, 'a shorter id inside a longer one is not a match');
});

test('a home message is never tied to a Discord send', () => {
  freshHouse();
  store('companion', 'Said at home.', 'web');
  assert.equal(findReplyRow(THREAD, 'Said at home.'), null);
});

test('a reaction lands on its bubble under the reactor, and comes back off when taken back', () => {
  freshHouse();
  const reply = store('companion', 'A reply in the cafe.');
  recordSentDiscordIds(THREAD, 'A reply in the cafe.', 'chan', ['999']);
  const added = carryDiscordReaction('add', '999', '❤️', { id: '42', name: 'Sam' });
  assert.deepEqual(added, { messageId: reply, emoji: '❤️', user: 'discord:42', name: 'Sam' });
  assert.deepEqual(reactionsOn(reply).map((r) => [r.emoji, r.user, r.name]), [['❤️', 'discord:42', 'Sam']]);
  assert.equal(carryDiscordReaction('add', '999', '❤️', { id: '42', name: 'Sam' }), null, 'a repeat changes nothing');
  carryDiscordReaction('add', '999', '❤️', { id: '43', name: 'Danielle' });
  assert.equal(reactionsOn(reply).length, 2, 'two people, same heart, two reactions');
  assert.ok(carryDiscordReaction('remove', '999', '❤️', { id: '42', name: 'Sam' }));
  assert.deepEqual(reactionsOn(reply).map((r) => r.user), ['discord:43']);
});

test('a reaction on a message that is not one of ours goes nowhere', () => {
  freshHouse();
  store('companion', 'A reply in the cafe.');
  assert.equal(carryDiscordReaction('add', '555', '❤️', { id: '42', name: 'Sam' }), null);
});

test('a reaction on a message that came in from Discord lands on that bubble, theirs or a guest\'s', () => {
  freshHouse();
  const theirs = `m${++n}`;
  createMessage({ id: theirs, threadId: THREAD, role: 'user', content: 'two messages, one batch', platform: 'discord',
    metadata: { discordMessageId: '702', discordMessageIds: ['701', '702'] }, createdAt: new Date().toISOString() });
  const guest = `m${++n}`;
  createMessage({ id: guest, threadId: THREAD, role: 'system', content: 'a guest in the cafe', platform: 'discord',
    metadata: { discordMessageId: '801' }, createdAt: new Date().toISOString() });
  assert.equal(findRowByDiscordId('701'), theirs, 'the first message of a batch finds its row too');
  assert.equal(findRowByDiscordId('801'), guest, 'a row stored with only its last id is still found');
  assert.ok(carryDiscordReaction('add', '701', '🔥', { id: '42', name: 'Sam' }));
  assert.ok(carryDiscordReaction('add', '801', '😂', { id: '43', name: 'Alex' }));
  assert.deepEqual(reactionsOn(theirs).map((r) => [r.emoji, r.name]), [['🔥', 'Sam']]);
  assert.deepEqual(reactionsOn(guest).map((r) => [r.emoji, r.name]), [['😂', 'Alex']]);
});

test('a role-ping note shares the id but is not a Discord row, so it never takes the reaction', () => {
  freshHouse();
  createMessage({ id: 'note', threadId: THREAD, role: 'system', content: 'Held for you', metadata: { discordMessageId: '901' }, createdAt: new Date().toISOString() });
  const row = `m${++n}`;
  createMessage({ id: row, threadId: THREAD, role: 'system', content: 'the ping itself', platform: 'discord', metadata: { discordMessageId: '901' }, createdAt: new Date().toISOString() });
  assert.equal(findRowByDiscordId('901'), row);
});
