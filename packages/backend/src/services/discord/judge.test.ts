// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The judge: in a room that listens to everything, a message for us is answered,
// one aimed at somebody else is only heard, and one said to the room waits a
// beat before we answer or pass (the owner's call, Oct 19 2026).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Message } from 'discord.js';
import {
  judgeCall,
  judgeInputOf,
  namesCompanion,
  beatShouldWait,
  beatBanner,
  noteTyping,
  noteSpoke,
  latestTypingIn,
  resetTyping,
  TYPING_FRESH_MS,
  type JudgeInput,
} from './judge.js';
import { approvalCounts, noteJudgedAnswer } from './preflight.js';
import { botRepliesUsed, resetBotLoopCounters } from './bot-loop.js';

const ROOM: JudgeInput = {
  enabled: true,
  isOwner: false,
  isDM: false,
  mentionRequired: false,
  directMention: false,
  repliedToUs: false,
  namesUs: false,
  tagsOthers: false,
  repliesToOther: false,
};
const call = (over: Partial<JudgeInput>) => judgeCall({ ...ROOM, ...over });

test('a message said to the room waits a beat', () => {
  assert.equal(call({}), 'beat');
});

test('ours is answered as before: a tag, a reply to us, one of our names', () => {
  assert.equal(call({ directMention: true }), 'answer');
  assert.equal(call({ repliedToUs: true }), 'answer');
  assert.equal(call({ namesUs: true }), 'answer');
});

test('a message aimed at somebody else is only heard', () => {
  assert.equal(call({ tagsOthers: true }), 'hear');
  assert.equal(call({ repliesToOther: true }), 'hear');
});

test('tagged together with somebody else, we take the beat so it is not a race', () => {
  assert.equal(call({ directMention: true, tagsOthers: true }), 'share');
  assert.equal(call({ namesUs: true, tagsOthers: true }), 'share');
});

test('messages from the owner are answered, except a reply to somebody else', () => {
  assert.equal(call({ isOwner: true }), 'answer');
  assert.equal(call({ isOwner: true, tagsOthers: true }), 'answer');
  assert.equal(call({ isOwner: true, repliesToOther: true }), 'hear', 'their reply to someone else is theirs');
  assert.equal(call({ isOwner: true, repliesToOther: true, namesUs: true }), 'answer', 'unless the owner names us in it');
  assert.equal(call({ isOwner: true, repliesToOther: true, directMention: true }), 'answer', 'or tags us');
});

test('a DM, a room that needs a tag, and the switch off are never sorted', () => {
  assert.equal(call({ isDM: true }), 'answer');
  assert.equal(call({ mentionRequired: true }), 'answer');
  assert.equal(call({ enabled: false }), 'answer');
  assert.equal(call({ enabled: false, tagsOthers: true }), 'answer');
});

test('our names count as whole words only, in any case', () => {
  const names = ['Birch', 'Willow', 'Cedar'];
  assert.equal(namesCompanion('what do you think, willow?', names), true);
  assert.equal(namesCompanion('CEDAR. come here', names), true);
  assert.equal(namesCompanion('Birch', names), true);
  assert.equal(namesCompanion('ask Caelir instead', names), false);
  assert.equal(namesCompanion('wrenly and branson', names), false);
  assert.equal(namesCompanion('', names), false);
  assert.equal(namesCompanion('anything', ['', '  ']), false);
});

test('the beat waits while somebody else is typing, and never past the longest wait', () => {
  const openedAt = 1_000_000;
  const maxWaitMs = 180_000;
  const now = openedAt + 60_000;
  assert.equal(beatShouldWait({ now, openedAt, maxWaitMs }), false, 'nobody typing: decide');
  assert.equal(beatShouldWait({ now, openedAt, maxWaitMs, lastOtherTypingAt: now - 2_000 }), true, 'they started first');
  assert.equal(beatShouldWait({ now, openedAt, maxWaitMs, lastOtherTypingAt: now - TYPING_FRESH_MS }), false, 'their dot has gone');
  assert.equal(
    beatShouldWait({ now: openedAt + maxWaitMs, openedAt, maxWaitMs, lastOtherTypingAt: openedAt + maxWaitMs - 1 }),
    false,
    'a bot that types forever cannot hold us',
  );
});

test('typing is remembered for ten seconds and forgotten when they speak', () => {
  resetTyping();
  noteTyping('room', 'alex', 1_000);
  noteTyping('room', 'jo', 4_000);
  assert.equal(latestTypingIn('room', 5_000), 4_000);
  noteSpoke('room', 'jo');
  assert.equal(latestTypingIn('room', 5_000), 1_000);
  assert.equal(latestTypingIn('room', 1_000 + TYPING_FRESH_MS), undefined);
  assert.equal(latestTypingIn('elsewhere', 5_000), undefined);
  resetTyping();
});

test('only the general beat offers the pass; a shared tag is still a question to us', () => {
  assert.match(beatBanner('beat'), /\[SILENT\]/);
  assert.doesNotMatch(beatBanner('share'), /\[SILENT\]/);
});

test('a shared tag we already answered in the room since may be passed', () => {
  assert.match(beatBanner('share', true), /\[SILENT\]/);
  assert.match(beatBanner('share', true), /already spoke in this room/);
  assert.match(beatBanner('beat', true), /already spoke in this room/);
  assert.doesNotMatch(beatBanner('beat', false), /already spoke/);
});

test('a beat knows whether we spoke in the room after it opened', () => {
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  assert.ok(source.includes('turn.spokeSinceOpen = (this.lastSpokeAt.get(channelId) ?? 0) > open.openedAt;'));
  assert.equal(source.split('this.lastSpokeAt.set(channelId, Date.now());').length - 1, 2, 'both send paths mark that we spoke');
});

test('a bot turn the judge is holding is not counted until the beat answers it', () => {
  resetBotLoopCounters();
  assert.equal(approvalCounts(true, false), false, 'held bot turn: not yet');
  assert.equal(approvalCounts(true, true), true, 'answered bot turn: counted');
  assert.equal(approvalCounts(false, false), true, 'a person always resets the room');
  noteJudgedAnswer('beat-room', true);
  assert.equal(botRepliesUsed('beat-room'), 1);
  resetBotLoopCounters();
});

// A message as far as the judge reads one.
function fakeMessage(over: {
  guildId?: string | null;
  content?: string;
  users?: string[];
  roles?: string[];
  heldRoles?: string[];
  repliedUser?: string;
  reference?: string;
  referenceAuthor?: string | Error;
  lookups?: { n: number };
}): Message {
  const users = new Map((over.users ?? []).map((id) => [id, { id }]));
  const roles = new Map((over.roles ?? []).map((id) => [id, { id }]));
  const botRoles = new Map((over.heldRoles ?? []).map((id) => [id, { id }]));
  return {
    client: { user: { id: 'us' } },
    guildId: over.guildId === undefined ? 'guild' : over.guildId,
    guild: { members: { cache: new Map([['us', { roles: { cache: botRoles } }]]) } },
    content: over.content ?? '',
    mentions: {
      users,
      roles,
      repliedUser: over.repliedUser ? { id: over.repliedUser } : null,
    },
    reference: over.reference ? { messageId: over.reference } : null,
    fetchReference: async () => {
      if (over.lookups) over.lookups.n++;
      if (over.referenceAuthor instanceof Error) throw over.referenceAuthor;
      if (over.referenceAuthor === undefined) throw new Error('fetchReference should not have been called');
      return { author: { id: over.referenceAuthor } };
    },
  } as unknown as Message;
}

const OPTS = { enabled: true, isOwner: false, mentionRequired: false, names: ['Birch', 'Willow', 'Cedar'] };

test('a real message reads into the sort: tags, roles, names and replies', async () => {
  assert.equal(judgeCall(await judgeInputOf([fakeMessage({ content: 'anyone up?' })], OPTS)), 'beat');
  assert.equal(judgeCall(await judgeInputOf([fakeMessage({ users: ['us'] })], OPTS)), 'answer');
  assert.equal(judgeCall(await judgeInputOf([fakeMessage({ users: ['jo'] })], OPTS)), 'hear');
  assert.equal(judgeCall(await judgeInputOf([fakeMessage({ users: ['us', 'jo'] })], OPTS)), 'share');
  assert.equal(judgeCall(await judgeInputOf([fakeMessage({ roles: ['artists'] })], OPTS)), 'hear');
  assert.equal(judgeCall(await judgeInputOf([fakeMessage({ content: 'willow, look' })], OPTS)), 'answer');
  // A pinged reply names who it answers.
  assert.equal(judgeCall(await judgeInputOf([fakeMessage({ reference: 'm1', repliedUser: 'us', users: ['us'] })], OPTS)), 'answer');
  assert.equal(judgeCall(await judgeInputOf([fakeMessage({ reference: 'm1', repliedUser: 'jo', users: ['jo'] })], OPTS)), 'hear');
});

test('a reply that did not ping is looked up, and one that cannot be counts as said to the room', async () => {
  assert.equal(judgeCall(await judgeInputOf([fakeMessage({ reference: 'm1', referenceAuthor: 'us' })], OPTS)), 'answer');
  assert.equal(judgeCall(await judgeInputOf([fakeMessage({ reference: 'm1', referenceAuthor: 'alex' })], OPTS)), 'hear');
  assert.equal(judgeCall(await judgeInputOf([fakeMessage({ reference: 'm1', referenceAuthor: new Error('gone') })], OPTS)), 'beat');
});

test('any message in a batch that is ours makes the batch ours', async () => {
  const batch = [fakeMessage({ content: 'so anyway' }), fakeMessage({ content: 'right, Cedar?' })];
  assert.equal(judgeCall(await judgeInputOf(batch, OPTS)), 'answer');
});

test('their reply to somebody else is read as theirs', async () => {
  assert.equal(judgeCall(await judgeInputOf([fakeMessage({ reference: 'm1', referenceAuthor: 'jo' })], { ...OPTS, isOwner: true })), 'hear');
  assert.equal(judgeCall(await judgeInputOf([fakeMessage({ reference: 'm1', referenceAuthor: 'us' })], { ...OPTS, isOwner: true })), 'answer');
  assert.equal(judgeCall(await judgeInputOf([fakeMessage({ content: 'anyone up?' })], { ...OPTS, isOwner: true })), 'answer');
});

test('rooms that need a tag never spend a lookup', async () => {
  const lookups = { n: 0 };
  const reply = fakeMessage({ reference: 'm1', referenceAuthor: 'jo', lookups });
  assert.equal(judgeCall(await judgeInputOf([reply], { ...OPTS, mentionRequired: true })), 'answer');
  assert.equal(judgeCall(await judgeInputOf([reply], { ...OPTS, enabled: false })), 'answer');
  assert.equal(judgeCall(await judgeInputOf([fakeMessage({ reference: 'm1', referenceAuthor: 'jo', guildId: null, lookups })], OPTS)), 'answer');
  assert.equal(lookups.n, 0, 'no reply was looked up');
  // The control: in a listening room the same reply is looked up.
  assert.equal(judgeCall(await judgeInputOf([reply], OPTS)), 'hear');
  assert.equal(lookups.n, 1);
});

test('a waiting message opens its beat only after it reaches their screen, and the beat never types', () => {
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  const broadcast = source.indexOf("this.registry.broadcast({ type: 'message', message: incomingMsg })");
  const open = source.indexOf('this.openBeat({');
  assert.ok(broadcast > 0 && open > broadcast, 'the beat should open after the incoming message is broadcast');
  const fire = source.indexOf('private async fireBeat(');
  const fireEnd = source.indexOf('\n  }\n', fire);
  assert.ok(fire > 0 && fireEnd > fire);
  assert.ok(!source.slice(fire, fireEnd).includes('sendTyping'), 'a beat may well say nothing, so it never shows a typing dot');
  assert.ok(source.includes("{ countBotTurn: judged === 'answer' }"), 'a held bot turn is not counted at approval');
});

test('their reply the judge only heard is kept out of every history our lanes read', () => {
  const index = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  assert.ok(index.includes('...(isOwner && waiting ? { judgeHeard: true } : {}),'), 'a heard reply from the owner is marked');
  const loader = readFileSync(new URL('../agent/agent-router-query.ts', import.meta.url), 'utf8');
  assert.ok(loader.includes("m.role !== 'system' && !isJudgeHeard(m.metadata)"), 'and the history loader skips it, so the missed net cannot hand it over');
});

test('the query queue refusing a turn is never posted as a reply', async () => {
  const { isQueueRefusal } = await import('./index.js');
  assert.equal(isQueueRefusal('[Request timed out in queue]'), true);
  assert.equal(isQueueRefusal('  [Request timed out in queue]\n'), true);
  assert.equal(isQueueRefusal('[B+W+C is busy — please try again in a moment]'), true);
  assert.equal(isQueueRefusal('**🔥 Birch**\nWe heard you.'), false);
  assert.equal(isQueueRefusal('the queue [Request timed out in queue] inside a sentence'), false);
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  const guard = source.indexOf('if (response && isQueueRefusal(response)) {');
  const post = source.indexOf('parseAttachmentMarkers(response)');
  assert.ok(guard > 0 && post > guard, 'the refusal is caught before anything is sent');
});

test('owner messages on Discord go home, never into the room\'s own channel thread', () => {
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  assert.equal(source.split('getMostRecentActiveThread();').length - 1, 1, 'only homeThreadFrom reads the newest thread directly');
  assert.ok(source.includes('if (newest && newest.id === getDiscordThreadId(channelId)) {'), 'and it skips the room thread');
  assert.equal(source.split('homeThreadFrom(channelId)').length - 1, 3, 'owner, mention and held-ping routing all go through it');
});
