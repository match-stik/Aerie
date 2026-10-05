// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Preflight validation — layered auth pipeline

import type { Message } from 'discord.js';
import type { PreflightResult, MessageBatch } from './types.js';
import { DISCORD_CONFIG } from './config.js';
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
 * Every approved message is counted on the way out, in one place, so the
 * consecutive-bot guard cannot be bypassed by a branch that returns early.
 * A human resets the channel; a bot spends one of its turns.
 */
export async function preflight(batch: MessageBatch, pairingService: PairingService): Promise<PreflightResult> {
  const result = await decide(batch, pairingService);
  if (result.allowed) noteApproved(batch.channelId, batch.firstMessage.author.bot);
  return result;
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
