// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Discord configuration — DB-backed with config.yaml fallback defaults
// Reads from config table (key-value store) with sensible defaults

import { getConfig, getConfigBool, getConfigNumber } from '../db.js';
import { getAerieConfig } from '../../config.js';
import { ownerNamesFrom } from './owner-mention.js';

export interface DiscordConfigValues {
  ownerUserId: string;
  requireMentionInGuilds: boolean;
  debounceMs: number;
  pairingExpiryMs: number;
  ownerActiveThresholdMin: number;
  deferPollIntervalMs: number;
  deferMaxAgeMs: number;
  /** The judge in rooms that need no mention (see judge.ts). */
  judgeEnabled: boolean;
  /** How long a message said to the room waits before we decide. */
  judgeBeatMs: number;
  /** The longest a beat waits on somebody else's typing. */
  judgeMaxWaitMs: number;
}

const DEFAULTS = {
  requireMentionInGuilds: true,
  debounceMs: 1500,
  pairingExpiryMs: 3600000,
  ownerActiveThresholdMin: 0,
  deferPollIntervalMs: 30000,
  deferMaxAgeMs: 600000,
  judgeEnabled: true,
  judgeBeatMs: 60000,
  judgeMaxWaitMs: 180000,
};

export function getDiscordConfig(): DiscordConfigValues {
  const appConfig = getAerieConfig();
  return {
    ownerUserId: getConfig('discord.ownerUserId') || appConfig.discord.owner_user_id || '',
    requireMentionInGuilds: getConfigBool('discord.requireMentionInGuilds', DEFAULTS.requireMentionInGuilds),
    debounceMs: getConfigNumber('discord.debounceMs', DEFAULTS.debounceMs),
    pairingExpiryMs: getConfigNumber('discord.pairingExpiryMs', DEFAULTS.pairingExpiryMs),
    ownerActiveThresholdMin: getConfigNumber('discord.ownerActiveThresholdMin', DEFAULTS.ownerActiveThresholdMin),
    deferPollIntervalMs: getConfigNumber('discord.deferPollIntervalMs', DEFAULTS.deferPollIntervalMs),
    deferMaxAgeMs: getConfigNumber('discord.deferMaxAgeMs', DEFAULTS.deferMaxAgeMs),
    judgeEnabled: getConfigBool('discord.judgeEnabled', DEFAULTS.judgeEnabled),
    judgeBeatMs: getConfigNumber('discord.judgeBeatMs', DEFAULTS.judgeBeatMs),
    judgeMaxWaitMs: getConfigNumber('discord.judgeMaxWaitMs', DEFAULTS.judgeMaxWaitMs),
  };
}

export interface OwnerMentionSettings {
  enabled: boolean;
  names: string[];
}

/**
 * Whether a Discord message ABOUT the owner (an @mention of the owner, a reply to
 * the owner, their name from a person) is delivered to their thread with a notification,
 * and which names count. Read live on every message, like everything above,
 * so flipping the row takes effect without a restart.
 *
 * Off unless switched on: a public install should not start carrying other
 * people's conversations into the house the day it is set up. Names left
 * empty fall back to identity.user_name.
 */
export function getOwnerMentionSettings(): OwnerMentionSettings {
  return {
    enabled: getConfigBool('discord.owner_mentions', false),
    names: ownerNamesFrom(getConfig('discord.owner_names'), getAerieConfig().identity.user_name),
  };
}

// Set-based config (comma-separated strings in DB)
export function getAllowedUsers(): Set<string> {
  const val = getConfig('discord.allowedUsers');
  if (val) {
    return new Set(val.split(',').map(s => s.trim()).filter(Boolean));
  }
  // Default: owner only
  const ownerUserId = getDiscordConfig().ownerUserId;
  return ownerUserId ? new Set([ownerUserId]) : new Set();
}

export function getAllowedGuilds(): Set<string> {
  const val = getConfig('discord.allowedGuilds');
  return val
    ? new Set(val.split(',').map(s => s.trim()).filter(Boolean))
    : new Set();
}

export function getActiveChannels(): Set<string> {
  const val = getConfig('discord.activeChannels');
  return val
    ? new Set(val.split(',').map(s => s.trim()).filter(Boolean))
    : new Set();
}

// Backward compat — used by debouncer.ts, preflight.ts
// Returns an object that reads from DB on each property access
export const DISCORD_CONFIG = {
  get ownerUserId() { return getDiscordConfig().ownerUserId; },
  get allowedUsers() { return getAllowedUsers(); },
  get allowedGuilds() { return getAllowedGuilds(); },
  get activeChannels() { return getActiveChannels(); },
  get requireMentionInGuilds() { return getDiscordConfig().requireMentionInGuilds; },
  get debounceMs() { return getDiscordConfig().debounceMs; },
  get pairingExpiryMs() { return getDiscordConfig().pairingExpiryMs; },
};
