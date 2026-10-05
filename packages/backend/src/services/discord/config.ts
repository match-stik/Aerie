// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Discord configuration — DB-backed with config.yaml fallback defaults
// Reads from config table (key-value store) with sensible defaults

import { getConfig, getConfigBool, getConfigNumber } from '../db.js';
import { getAerieConfig } from '../../config.js';

export interface DiscordConfigValues {
  ownerUserId: string;
  requireMentionInGuilds: boolean;
  debounceMs: number;
  pairingExpiryMs: number;
  ownerActiveThresholdMin: number;
  deferPollIntervalMs: number;
  deferMaxAgeMs: number;
}

const DEFAULTS = {
  requireMentionInGuilds: true,
  debounceMs: 1500,
  pairingExpiryMs: 3600000,
  ownerActiveThresholdMin: 0,
  deferPollIntervalMs: 30000,
  deferMaxAgeMs: 600000,
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
