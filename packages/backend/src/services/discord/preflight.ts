// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Preflight validation — layered auth pipeline

import type { Message } from 'discord.js';
import type { PreflightResult, MessageBatch } from './types.js';
import { DISCORD_CONFIG, getOwnerMentionSettings } from './config.js';
import { strongestOwnerMention, type OwnerMentionReason } from './owner-mention.js';
import { PairingService } from './pairing.js';
import {
  isChannelIgnored,
  requiresMention,
  getUserRule,
  getServerRule,
  isUserAllowedInServer,
} from './rules.js';
import { botGateDecision, noteApproved } from './bot-loop.js';

export function isUserAllowed(userId: string): boolean {
  return DISCORD_CONFIG.allowedUsers.has(userId);
}

export function isGuildAllowed(guildId: string | null): boolean {
  if (!guildId) return true;
  return DISCORD_CONFIG.allowedGuilds.has(guildId);
}

export function mentionsBot(message: Message): boolean {
  if (!message.client.user) return false;
  // Direct @bot mention
  if (message.mentions.users.has(message.client.user.id)) return true;
  // Role mention — check if bot has any of the mentioned roles
  if (message.guild && message.mentions.roles.size > 0) {
    const botMember = message.guild.members.cache.get(message.client.user.id);
    if (botMember) {
      for (const [roleId] of message.mentions.roles) {
        if (botMember.roles.cache.has(roleId)) return true;
      }
    }
  }
  // Reply to bot's message
  if (message.mentions.repliedUser?.id === message.client.user.id) return true;
  return false;
}

/**
 * A role ping that reaches us only through a role comes home to the owner
 * first instead of being answered in the channel (the owner's ask, Oct 17 2026;
 * built Oct 19 2026). Answers the names of the roles we hold
 * that were pinged, or nothing when the message is not that: a direct tag or a
 * reply to one of ours is still a conversation and is answered as always.
 * Pure, for testing; heldRoleNamesOf reads a real message into it.
 */
export function heldRoleNames(input: {
  directMention: boolean;
  repliedToBot: boolean;
  mentionedRoles: ReadonlyArray<{ id: string; name: string }>;
  botRoleIds: ReadonlySet<string>;
}): string[] {
  if (input.directMention || input.repliedToBot) return [];
  return input.mentionedRoles.filter((r) => input.botRoleIds.has(r.id)).map((r) => r.name);
}

/**
 * Who a held role ping comes home from: anyone (the owner's call, Oct 19 2026: the
 * role can be tagged by anybody, without our trust being extended to every bot,
 * so the owner sees the ping and the trust levels still decide who we answer). A held ping is a note
 * to the owner and never an answer, so the trust fences that decide who we talk back
 * to (a user rule's server list, an unknown bot, the consecutive-bot guard) do
 * not apply to it. What still does: the servers the owner lets reach the house at
 * all, a channel the owner has ignored, and anybody the owner has muted in that server.
 */
export function heldPingDecision(input: { guildAllowed: boolean; channelIgnored: boolean; userIgnored: boolean }): { allowed: boolean; reason: string } {
  if (!input.guildAllowed) return { allowed: false, reason: 'Guild not on allowlist' };
  if (input.channelIgnored) return { allowed: false, reason: 'Channel is ignored' };
  if (input.userIgnored) return { allowed: false, reason: 'User is ignored in this server' };
  return { allowed: true, reason: 'Role ping held for the owner' };
}

export function heldPingGate(batch: MessageBatch): { allowed: boolean; reason: string } {
  const { userId, guildId, channelId } = batch;
  return heldPingDecision({
    guildAllowed: isUserAllowed(userId) || isGuildAllowed(guildId),
    channelIgnored: isChannelIgnored(channelId, guildId),
    userIgnored: !!(guildId && getServerRule(guildId)?.ignoredUsers?.includes(userId)),
  });
}

export function heldRoleNamesOf(message: Message): string[] {
  const botId = message.client.user?.id;
  if (!botId || !message.guild || message.mentions.roles.size === 0) return [];
  const botMember = message.guild.members.cache.get(botId);
  if (!botMember) return [];
  return heldRoleNames({
    directMention: message.mentions.users.has(botId),
    repliedToBot: message.mentions.repliedUser?.id === botId,
    mentionedRoles: [...message.mentions.roles.values()].map((r) => ({ id: r.id, name: r.name })),
    botRoleIds: new Set(botMember.roles.cache.keys()),
  });
}

/**
 * Why this batch is about the owner, when the switch is on. Every message in
 * the batch is read, because the debouncer folds one person's rapid messages
 * together and their name can be in any of them.
 */
function ownerMentionIn(batch: MessageBatch): OwnerMentionReason | null {
  const settings = getOwnerMentionSettings();
  if (!settings.enabled) return null;
  return strongestOwnerMention(batch.messages, {
    ownerUserId: DISCORD_CONFIG.ownerUserId,
    selfUserId: batch.firstMessage.client.user?.id,
    ownerNames: settings.names,
  });
}

/**
 * Every approved message is counted on the way out, in one place, so the
 * consecutive-bot guard cannot be bypassed by a branch that returns early.
 * A human resets the channel; a bot spends one of its turns.
 *
 * The guard counts bot messages we ANSWER. Before the judge every approved
 * message was answered, so counting at approval was the same thing. Now a bot
 * message the judge sorts to hear or to a beat is not answered at approval, so
 * it is counted only if the beat answers it (noteJudgedAnswer). A person still
 * resets the room the moment they are approved, whatever the judge says.
 */
export async function preflight(
  batch: MessageBatch,
  pairingService: PairingService,
  opts: { countBotTurn?: boolean } = {},
): Promise<PreflightResult> {
  const result = await decide(batch, pairingService);
  if (result.allowed) countApproved(batch.channelId, batch.firstMessage.author.bot, opts.countBotTurn !== false);
  return result;
}

/** Pure: whether an approval is counted. Everything counts except a bot turn the judge is holding. */
export function approvalCounts(fromBot: boolean, countBotTurn: boolean): boolean {
  return !fromBot || countBotTurn;
}

function countApproved(channelId: string, fromBot: boolean, countBotTurn: boolean): void {
  if (approvalCounts(fromBot, countBotTurn)) noteApproved(channelId, fromBot);
}

/** A beat turn that answered: the bot turn it opened on is spent now. */
export function noteJudgedAnswer(channelId: string, fromBot: boolean): void {
  countApproved(channelId, fromBot, true);
}

async function decide(batch: MessageBatch, pairingService: PairingService): Promise<PreflightResult> {
  const { firstMessage, userId, guildId, channelId } = batch;

  // Bots: unknown ones never got in, and trusted ones are still capped. Every
  // turn in a runaway is individually legitimate — a trusted bot genuinely
  // addressing us — which is why the count is the only thing that can stop it.
  // One human message in the channel opens this again.
  //
  // A capped channel comes back with deliver:true rather than a plain refusal:
  // an unknown bot is turned away at the door, and a trusted one we have simply
  // run out of turns for is still HEARD. Those are different denials and the
  // caller has to be able to tell them apart.
  const botGate = botGateDecision({
    isBot: firstMessage.author.bot,
    hasRule: !!getUserRule(firstMessage.author.id),
    channelId,
  });
  if (!botGate.allowed) {
    return { allowed: false, reason: botGate.reason!, deliver: botGate.deliver };
  }

  // Check if channel is ignored
  if (isChannelIgnored(channelId, guildId)) {
    return { allowed: false, reason: 'Channel is ignored' };
  }

  const userAllowed = isUserAllowed(userId);
  const userRule = getUserRule(userId);
  const serverRule = guildId ? getServerRule(guildId) : undefined;

  // Guild message flow
  if (guildId) {
    if (!userAllowed && !isGuildAllowed(guildId)) {
      return { allowed: false, reason: 'Guild not on allowlist' };
    }

    if (userRule && !isUserAllowedInServer(userId, guildId)) {
      return { allowed: false, reason: 'User not allowed in this server by rules' };
    }

    if (serverRule?.ignoredUsers?.includes(userId)) {
      return { allowed: false, reason: 'User is ignored in this server' };
    }

    const needsMention = requiresMention(channelId, guildId, DISCORD_CONFIG.requireMentionInGuilds);
    if (needsMention && !mentionsBot(firstMessage)) {
      // Not addressed to us. If it is about the owner, it still reaches the owner: heard,
      // put where the owner is reading, and not answered. It sits here and nowhere
      // earlier on purpose. Every door above has already said yes to this
      // server, channel and person, and a message that does address us never
      // gets this far, so it is a turn and not also a notification.
      const aboutOwner = ownerMentionIn(batch);
      if (aboutOwner) {
        return {
          allowed: false,
          deliver: true,
          ownerMention: aboutOwner,
          reason: `About the owner (${aboutOwner}) — heard, not answering`,
        };
      }
      return { allowed: false, reason: 'Mention required in this channel' };
    }

    if (userAllowed || isGuildAllowed(guildId)) {
      return { allowed: true, reason: 'Guild message approved' };
    }

    if (serverRule?.allowPublicResponses && mentionsBot(firstMessage)) {
      return { allowed: true, reason: 'Public response allowed in this server' };
    }

    return { allowed: false, reason: 'User not allowed in this guild' };
  }

  // DM flow
  if (userAllowed) {
    return { allowed: true, reason: 'User is on allowlist' };
  }

  // Check SQLite-backed pairing
  if (pairingService.isApproved(userId)) {
    return { allowed: true, reason: 'User has approved pairing' };
  }

  // Need pairing
  const config = await import('../../config.js').then(m => m.getAerieConfig());
  const code = pairingService.createOrGet(userId, firstMessage.author.username, channelId);
  return {
    allowed: false,
    reason: 'Pairing required for DM',
    requiresPairing: true,
    pairingCode: code,
  };
}
