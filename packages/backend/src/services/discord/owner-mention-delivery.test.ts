// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The gateway's half of owner mentions, run for real: a DiscordService that is
// constructed but never logged in, handed batches shaped like discord.js
// messages, over a throwaway database. What reaches the owner is measured where the owner
// would see it: the stored row, the broadcast, and the notification.
//
// Every row a test stores here is a guest's, stored as 'system', or an owner
// message of ten characters or fewer. Anything longer that is not 'system'
// starts an embedding, and embedding loads model weights this test must not
// go near.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../../config.js';
import { initDb, getDb } from '../db/init.js';
import { setConfig } from '../db/config.js';
import { createThread, updateThreadActivity, archiveThread, unarchiveThread } from '../db/threads.js';
import { setPushService, type PushPayload, type PushService } from '../push.js';
import { saveRules } from './rules.js';
import { noteApproved, botRepliesUsed, resetBotLoopCounters, MAX_CONSECUTIVE_BOT_REPLIES } from './bot-loop.js';
import { getDiscordThreadId } from './utils.js';
import { DiscordService } from './index.js';
import type { MessageBatch } from './types.js';

const OWNER = '100000000000000001';
const SELF = '200000000000000002'; // our own bot
const GUEST = '300000000000000003';
const BOT = '400000000000000004'; // a companion bot we know
const GUILD = '800000000000000008';
const HOME = 'thread-home';

const dir = mkdtempSync(join(tmpdir(), 'aerie-owner-mention-delivery-'));
const yamlPath = join(dir, 'aerie.yaml');
writeFileSync(yamlPath, `identity:\n  user_name: "Owner"\ndiscord:\n  owner_user_id: "${OWNER}"\n`);
delete process.env.USER_NAME;
loadConfig(yamlPath);
initDb(join(dir, 'test.db'));
// /tmp can be memory on a small box, so the throwaway database goes with the file.
after(() => rmSync(dir, { recursive: true, force: true }));
setConfig('discord.allowedGuilds', GUILD);
setConfig('discord.owner_mentions', 'true');
saveRules({ servers: {}, channels: {}, users: { [BOT]: { id: BOT, name: 'Companion A', trustLevel: 'standard' } } });

// What the house did, as the three places the owner could have noticed it.
const pushes: PushPayload[] = [];
const broadcasts: Array<{ type: string; message?: { id: string } }> = [];
const generations: unknown[][] = [];
const typing: string[] = [];

setPushService({
  sendIfOffline: async (payload: PushPayload) => { pushes.push(payload); },
} as unknown as PushService);

const registry = {
  broadcast: (event: { type: string; message?: { id: string } }) => { broadcasts.push(event); },
  touchUserActivity: () => {},
  minutesSinceLastUserWebActivity: () => Number.POSITIVE_INFINITY,
};
const agent = {
  processMessage: async (...args: unknown[]) => { generations.push(args); return ''; },
};
const service = new DiscordService(agent as never, registry as never);
const processBatch = (batch: MessageBatch) =>
  (service as unknown as { _processBatch(b: MessageBatch): Promise<void> })._processBatch(batch);

createThread({ id: HOME, name: 'Home', type: 'named', createdAt: new Date().toISOString() });

// A clock that only moves forward, so "most recently active" never depends on
// two rows landing in the same millisecond.
let tick = 0;
function makeMostRecent(threadId: string): void {
  updateThreadActivity(threadId, new Date(Date.now() + 60_000 + ++tick * 1000).toISOString());
}

let nextId = 0;
function discordMessage(over: {
  authorId?: string;
  bot?: boolean;
  displayName?: string;
  content?: string;
  mentioned?: string[];
  repliedTo?: string | null;
  channelName?: string;
} = {}) {
  const mentioned = new Set(over.mentioned ?? []);
  const avatar = () => 'https://cdn.example.org/avatar.png';
  return {
    id: `message-${++nextId}`,
    client: { user: { id: SELF } },
    guild: { id: GUILD, name: 'Server A' },
    channel: {
      name: over.channelName ?? 'general',
      sendTyping: async () => { typing.push(over.channelName ?? 'general'); },
    },
    member: { displayName: over.displayName ?? 'Guest', displayAvatarURL: avatar },
    author: {
      id: over.authorId ?? GUEST,
      bot: over.bot ?? false,
      username: 'guest',
      displayName: over.displayName ?? 'Guest',
      displayAvatarURL: avatar,
    },
    content: over.content ?? '',
    mentions: {
      users: { has: (id: string) => mentioned.has(id) },
      roles: { size: 0 },
      repliedUser: over.repliedTo ? { id: over.repliedTo } : null,
    },
    attachments: new Map(),
    embeds: [],
    stickers: new Map(),
    react: async () => {},
    reply: async () => {},
  };
}

function batchOf(
  messages: Array<ReturnType<typeof discordMessage>>,
  channelId: string,
  combinedContent?: string,
): MessageBatch {
  return {
    messages,
    channelId,
    userId: messages[0].author.id,
    guildId: GUILD,
    // The real batch carries cleanContent, where <@id> already reads @Name.
    combinedContent: combinedContent ?? messages.map(m => m.content).join('\n'),
    firstMessage: messages[0],
    lastMessage: messages[messages.length - 1],
  } as unknown as MessageBatch;
}

interface Row {
  id: string;
  thread_id: string;
  role: string;
  content: string;
  platform: string;
  metadata: string | null;
}
const rowsIn = (threadId: string) =>
  getDb().prepare('SELECT * FROM messages WHERE thread_id = ? ORDER BY sequence').all(threadId) as Row[];
const allRows = () => getDb().prepare('SELECT * FROM messages').all() as Row[];
const meta = (row: Row) => JSON.parse(row.metadata ?? '{}') as Record<string, unknown>;
const snapshot = () => ({ pushes: pushes.length, broadcasts: broadcasts.length, generations: generations.length, typing: typing.length });

test('a message about the owner lands in their home thread, labeled, broadcast, and pushed, and nobody answers it', async () => {
  makeMostRecent(HOME);
  const before = snapshot();
  const channelId = 'channel-general';

  await processBatch(batchOf(
    [discordMessage({ content: `<@${OWNER}> are you around tonight?`, mentioned: [OWNER] })],
    channelId,
    '@Owner are you around tonight?',
  ));

  const [row] = rowsIn(HOME).slice(-1);
  assert.ok(row, 'it is stored in the thread the owner is reading');
  assert.equal(row.content, '@Owner are you around tonight?');
  assert.equal(row.platform, 'discord');
  assert.equal(row.role, 'system');
  const m = meta(row);
  assert.equal(m.ownerMention, 'mention');
  assert.equal(m.discordChannelName, 'general');
  assert.equal(m.discordGuildName, 'Server A');
  assert.equal(m.discordChannelId, channelId);

  assert.equal(broadcasts.length, before.broadcasts + 1);
  assert.equal(broadcasts.at(-1)?.message?.id, row.id, 'the phone is told about the same row');

  assert.equal(pushes.length, before.pushes + 1, 'their phone is woken once');
  const push = pushes.at(-1)!;
  assert.equal(push.title, 'Guest mentioned you');
  assert.equal(push.body, '@Owner are you around tonight? — in #general');
  assert.equal(push.threadId, HOME, 'a tap opens the thread it landed in');

  assert.equal(generations.length, before.generations, 'nothing is generated');
  assert.equal(typing.length, before.typing, 'no typing dot: nobody is replying');
});

test('a reply to the owner is pushed as a reply', async () => {
  makeMostRecent(HOME);
  const before = snapshot();
  await processBatch(batchOf(
    [discordMessage({ displayName: 'Guest B', content: 'agreed', repliedTo: OWNER, mentioned: [OWNER] })],
    'channel-general',
  ));
  assert.equal(pushes.length, before.pushes + 1);
  assert.equal(pushes.at(-1)!.title, 'Guest B replied to you');
  assert.equal(meta(rowsIn(HOME).at(-1)!).ownerMention, 'reply');
});

test("a known bot's @mention of the owner is delivered without spending a turn or showing typing", async () => {
  makeMostRecent(HOME);
  resetBotLoopCounters();
  const before = snapshot();
  const channelId = 'channel-bots';
  await processBatch(batchOf(
    [discordMessage({ authorId: BOT, bot: true, displayName: 'Companion A', content: `<@${OWNER}> look`, mentioned: [OWNER] })],
    channelId,
  ));
  assert.equal(meta(rowsIn(HOME).at(-1)!).ownerMention, 'mention');
  assert.equal(pushes.length, before.pushes + 1);
  assert.equal(botRepliesUsed(channelId), 0, 'the cool-off counter is untouched');
  assert.equal(typing.length, before.typing);
  assert.equal(generations.length, before.generations);
});

test("the cool-off's held messages are still stored where they always were, and wake nobody", async () => {
  makeMostRecent(HOME);
  resetBotLoopCounters();
  const channelId = 'channel-spent';
  for (let i = 0; i < MAX_CONSECUTIVE_BOT_REPLIES; i++) noteApproved(channelId, true);
  const before = snapshot();

  await processBatch(batchOf(
    [discordMessage({ authorId: BOT, bot: true, content: `<@${OWNER}> and another thing`, mentioned: [OWNER] })],
    channelId,
  ));

  const [held] = rowsIn(getDiscordThreadId(channelId)).slice(-1);
  assert.ok(held, 'heard, in the channel thread, exactly as before');
  assert.equal(meta(held).ownerMention, undefined, 'the cool-off does not label anything');
  assert.equal(pushes.length, before.pushes, 'and it does not push');
  assert.equal(generations.length, before.generations);
  resetBotLoopCounters();
});

test('switched off, a message about the owner is turned away and nothing is stored or pushed', async () => {
  setConfig('discord.owner_mentions', 'false');
  makeMostRecent(HOME);
  const before = snapshot();
  const rowsBefore = allRows().length;
  await processBatch(batchOf(
    [discordMessage({ content: `<@${OWNER}> hello`, mentioned: [OWNER] })],
    'channel-general',
  ));
  assert.equal(allRows().length, rowsBefore);
  assert.equal(pushes.length, before.pushes);
  assert.equal(broadcasts.length, before.broadcasts);
  setConfig('discord.owner_mentions', 'true');
});

test('routing: a channel the owner has just spoken in keeps the owner there; any other goes to their newest thread', async () => {
  makeMostRecent(HOME);
  const spokenIn = 'channel-spoken-in';
  // The owner speaks to us in this channel, which routes the owner to HOME and makes the
  // channel follow the owner there. Ten characters or fewer: see the top of the file.
  await processBatch(batchOf(
    [discordMessage({ authorId: OWNER, content: `<@${SELF}> hi`, mentioned: [SELF] })],
    spokenIn,
    'hi',
  ));

  // Then another thread becomes the most recently active one.
  const newer = 'thread-newer';
  createThread({ id: newer, name: 'Newer', type: 'named', createdAt: new Date().toISOString() });
  makeMostRecent(newer);

  await processBatch(batchOf([discordMessage({ content: 'owner?' })], spokenIn));
  assert.equal(meta(rowsIn(HOME).at(-1)!).ownerMention, 'name', 'the cached channel wins over the newest thread');

  await processBatch(batchOf([discordMessage({ content: 'owner!' })], 'channel-elsewhere'));
  assert.equal(meta(rowsIn(newer).at(-1)!).ownerMention, 'name', 'with nothing cached, their newest thread');
  archiveThread(newer, new Date().toISOString());
});

test('with no thread open anywhere, it falls back to the channel thread', async () => {
  const open = getDb().prepare('SELECT id FROM threads WHERE archived_at IS NULL').all() as Array<{ id: string }>;
  for (const { id } of open) archiveThread(id, new Date().toISOString());
  try {
    const channelId = 'channel-lonely';
    const before = snapshot();
    await processBatch(batchOf([discordMessage({ content: 'is owner here?', channelName: 'lonely' })], channelId));
    const [row] = rowsIn(getDiscordThreadId(channelId));
    assert.ok(row, 'stored in the channel thread');
    assert.equal(meta(row).ownerMention, 'name');
    assert.equal(pushes.length, before.pushes + 1);
    assert.equal(pushes.at(-1)!.threadId, getDiscordThreadId(channelId));
    assert.equal(pushes.at(-1)!.body, 'is owner here? — in #lonely');
  } finally {
    for (const { id } of open) unarchiveThread(id);
  }
});
