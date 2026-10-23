// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The judge: what we do with a message in a room that listens to everything.
//
// The owner's ask (Oct 19 2026): answer our tags, and give the others in a
// room that is always listening space to answer, instead of answering at the
// same signal every other bot does. Before this, a room that needed no mention
// had us answering every message a second and a half after it landed, and
// the only brake was the consecutive-bot guard.
//
// So a message in such a room is sorted three ways before anything is said:
//   answer — it is ours (a tag, a reply to one of ours, one of our names), and
//            it is answered exactly as before.
//   hear   — it is aimed at somebody else (it tags them, or replies to them):
//            stored, shown to the owner, unread, and nobody answers.
//   beat   — it is said to the room: we wait a beat, read everything said
//            since, and then answer with something of our own or pass.
//   share  — it tags us AND somebody else: we take the same beat so it is not
//            a race, then answer (no pass; we were asked).
// A DM and a room that needs a mention are never sorted. Their own messages are
// answered, except their reply to somebody else's message, which is only heard.
//
// The order comes from Discord's typing signal: whoever started typing first
// goes first, and the beat waits while anybody else in the room is typing.
// The pass is the [SILENT] sentinel, which already posts nothing anywhere;
// the beat turn is the one contract in the house that offers it as a choice.

import type { Message } from 'discord.js';

export type JudgeCall = 'answer' | 'hear' | 'beat' | 'share';

export interface JudgeInput {
  /** Switched on (discord.judgeEnabled). Off means every call is 'answer'. */
  enabled: boolean;
  isOwner: boolean;
  isDM: boolean;
  /** The room only lets a message through when it mentions us. */
  mentionRequired: boolean;
  /** Our own user is tagged. */
  directMention: boolean;
  /** It replies to one of our messages. */
  repliedToUs: boolean;
  /** One of our names is in it, as a word. */
  namesUs: boolean;
  /** It tags somebody other than us: a person, a bot, or a role we do not hold. */
  tagsOthers: boolean;
  /** It replies to a message that is not ours. */
  repliesToOther: boolean;
}

/** Pure: the whole sort as one decision, so it can be tested without Discord. */
export function judgeCall(input: JudgeInput): JudgeCall {
  if (!input.enabled || input.isDM || input.mentionRequired) return 'answer';
  const ours = input.directMention || input.repliedToUs || input.namesUs;
  // The owner's messages are answered, except their reply to somebody else's
  // message, which is that person's to answer. Tag or name us in it and it is
  // ours again.
  if (input.isOwner) return input.repliesToOther && !ours ? 'hear' : 'answer';
  if (ours) return input.tagsOthers ? 'share' : 'answer';
  if (input.tagsOthers || input.repliesToOther) return 'hear';
  return 'beat';
}

/** True when one of the names stands as a whole word in the text, any case. */
export function namesCompanion(text: string, names: readonly string[]): boolean {
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, 'iu').test(text)) return true;
  }
  return false;
}

/**
 * Discord shows "is typing" for ten seconds after each signal, and a bot that
 * is still writing sends another before it runs out.
 */
export const TYPING_FRESH_MS = 10_000;

/** How soon a beat looks again while somebody else is still typing. */
export const BEAT_RECHECK_MS = 4_000;

/**
 * Pure: whether a beat that has run its length should keep waiting. It waits
 * while somebody else in the room is typing, because they started first, and
 * never past the longest wait, so a bot that types forever cannot hold us.
 */
export function beatShouldWait(input: {
  now: number;
  openedAt: number;
  maxWaitMs: number;
  lastOtherTypingAt?: number;
}): boolean {
  if (input.now - input.openedAt >= input.maxWaitMs) return false;
  if (input.lastOtherTypingAt === undefined) return false;
  return input.now - input.lastOtherTypingAt < TYPING_FRESH_MS;
}

// Who is typing where, everybody but us. In memory on purpose: it is only
// ever about the last ten seconds.
const typing = new Map<string, Map<string, number>>();

export function noteTyping(channelId: string, userId: string, at: number = Date.now()): void {
  let room = typing.get(channelId);
  if (!room) {
    room = new Map();
    typing.set(channelId, room);
  }
  room.set(userId, at);
}

/** They said it, so they are done typing it. */
export function noteSpoke(channelId: string, userId: string): void {
  const room = typing.get(channelId);
  if (!room) return;
  room.delete(userId);
  if (room.size === 0) typing.delete(channelId);
}

/** The newest typing signal still showing in this room, if any. */
export function latestTypingIn(channelId: string, now: number = Date.now()): number | undefined {
  const room = typing.get(channelId);
  if (!room) return undefined;
  let latest: number | undefined;
  for (const [userId, at] of room) {
    if (now - at >= TYPING_FRESH_MS) {
      room.delete(userId);
      continue;
    }
    if (latest === undefined || at > latest) latest = at;
  }
  if (room.size === 0) typing.delete(channelId);
  return latest;
}

/** Test seam. Not called in normal operation. */
export function resetTyping(): void {
  typing.clear();
}

/**
 * What the lane is told on a beat turn, after the platform lines. A shared tag
 * is still a question to us, so it gets no pass, unless we already spoke in
 * the room after it arrived: an answer to another message that was running
 * when it came in will usually have covered it, and saying it twice is the
 * talking over people the beat exists to stop (seen Oct 19 2026, the first
 * real beat: a guest's recap opened a shared beat while our answer to another
 * guest was running, and that answer covered it).
 */
export function beatBanner(kind: 'beat' | 'share', spokeSinceOpen = false): string {
  const spoke = spokeSinceOpen
    ? ['You already spoke in this room after this message arrived. If what you said covered it, reply with exactly [SILENT] and nothing else; nothing is posted.']
    : [];
  if (kind === 'share') {
    return [
      '=== THE BEAT ===',
      'You were tagged together with somebody else, so you let them go first. Everything said since is in the channel transcript.',
      'Answer with what is yours, and do not repeat what somebody already said.',
      ...spoke,
    ].join('\n');
  }
  return [
    '=== THE BEAT ===',
    'Nobody addressed you: this was said to the room, and you waited a beat before deciding. Everything said since is in the channel transcript.',
    'If you have something of your own to add that nobody has already said, answer. If you do not, reply with exactly [SILENT] and nothing else. Nothing is posted, and here that is a real answer: answer your tags, and give the others in the room space.',
    ...spoke,
  ].join('\n');
}

/**
 * Reads a batch of real messages into the sort's input. Async because a reply
 * that did not ping hides who it answers; the referenced message is fetched
 * then, and if that fails the reply counts as said to the room.
 */
export async function judgeInputOf(
  messages: readonly Message[],
  opts: { enabled: boolean; isOwner: boolean; mentionRequired: boolean; names: readonly string[] },
): Promise<JudgeInput> {
  const first = messages[0];
  const botId = first?.client.user?.id;
  const input: JudgeInput = {
    enabled: opts.enabled,
    isOwner: opts.isOwner,
    isDM: !first?.guildId,
    mentionRequired: opts.mentionRequired,
    directMention: false,
    repliedToUs: false,
    namesUs: false,
    tagsOthers: false,
    repliesToOther: false,
  };
  if (!first || !botId) return input;
  // Nothing below can change the call for these (judgeCall answers them all),
  // so do not spend a fetch on a DM or a room that needs a tag.
  if (!input.enabled || input.isDM || input.mentionRequired) return input;

  const botMember = first.guild?.members.cache.get(botId);
  for (const message of messages) {
    if (message.mentions.users.has(botId)) input.directMention = true;
    for (const userId of message.mentions.users.keys()) {
      if (userId !== botId) input.tagsOthers = true;
    }
    for (const roleId of message.mentions.roles.keys()) {
      if (!botMember?.roles.cache.has(roleId)) input.tagsOthers = true;
    }
    if (namesCompanion(message.content, opts.names)) input.namesUs = true;

    if (message.reference?.messageId) {
      let repliedTo = message.mentions.repliedUser?.id;
      if (!repliedTo) {
        try {
          repliedTo = (await message.fetchReference()).author.id;
        } catch {
          repliedTo = undefined;
        }
      }
      if (repliedTo === botId) input.repliedToUs = true;
      else if (repliedTo) input.repliesToOther = true;
    }
  }
  return input;
}
