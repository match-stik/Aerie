// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Server/channel/user rules — DB-backed with JSON file fallback
// First boot: loads from data/discord-rules.json, then persists to DB

import { readFileSync } from 'fs';
import { join } from 'path';
import { getConfig, setConfig } from '../db.js';
import { PROJECT_ROOT } from '../../config.js';

export interface ServerRule {
  id: string;
  name: string;
  context: string;
  requireMention?: boolean;
  ignoredChannels?: string[];
  ignoredUsers?: string[];
  allowPublicResponses?: boolean;
}

export interface ChannelRule {
  id: string;
  name: string;
  serverId: string;
  context?: string;
  requireMention?: boolean;
  alwaysListen?: boolean;
  ignore?: boolean;
  readOnly?: boolean;
}

export interface UserRule {
  id: string;
  name: string;
  context?: string;
  allowedServers?: string[];
  blockedServers?: string[];
  trustLevel: 'full' | 'standard' | 'limited';
  relationship?: string;
}

export interface RulesData {
  servers: Record<string, ServerRule>;
  channels: Record<string, ChannelRule>;
  users: Record<string, UserRule>;
}

// Load rules from data directory (fallback for first boot)
const RULES_PATH = join(PROJECT_ROOT, 'data/discord-rules.json');

function loadRulesFromFile(): RulesData {
  try {
    const content = readFileSync(RULES_PATH, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.warn('[Discord Rules] Failed to load discord-rules.json, using empty rules:', (error as Error).message);
    return { servers: {}, channels: {}, users: {} };
  }
}

function loadRulesFromDb(): RulesData | null {
  const raw = getConfig('discord.rules');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    console.warn('[Discord Rules] Failed to parse rules from DB, falling back to file');
    return null;
  }
}

function loadRulesWithFallback(): RulesData {
  return loadRulesFromDb() || loadRulesFromFile();
}

// Active rule maps — lazily initialized on first access (DB may not be ready at import time)
export const serverRules: Map<string, ServerRule> = new Map();
export const channelRules: Map<string, ChannelRule> = new Map();
export const userRules: Map<string, UserRule> = new Map();

let rulesInitialized = false;

function ensureRulesLoaded(): void {
  if (rulesInitialized) return;
  rulesInitialized = true;
  const data = loadRulesWithFallback();
  for (const [k, v] of Object.entries(data.servers)) serverRules.set(k, v);
  for (const [k, v] of Object.entries(data.channels)) channelRules.set(k, v);
  for (const [k, v] of Object.entries(data.users)) userRules.set(k, v);
  console.log(`[Discord Rules] Loaded ${serverRules.size} server, ${channelRules.size} channel, ${userRules.size} user rules`);
}

// --- Getters ---

export function getServerRule(guildId: string | null): ServerRule | undefined {
  ensureRulesLoaded();
  if (!guildId) return undefined;
  return serverRules.get(guildId);
}

export function getChannelRule(channelId: string): ChannelRule | undefined {
  ensureRulesLoaded();
  return channelRules.get(channelId);
}

export function getUserRule(userId: string): UserRule | undefined {
  ensureRulesLoaded();
  return userRules.get(userId);
}

export function isChannelIgnored(channelId: string, guildId: string | null): boolean {
  const channelRule = getChannelRule(channelId);
  if (channelRule?.ignore) return true;

  if (guildId) {
    const serverRule = getServerRule(guildId);
    if (serverRule?.ignoredChannels?.includes(channelId)) return true;
  }

  return false;
}

export function requiresMention(channelId: string, guildId: string | null, defaultRequirement: boolean): boolean {
  if (!guildId) return false;

  const channelRule = getChannelRule(channelId);
  if (channelRule?.requireMention !== undefined) return channelRule.requireMention;
  if (channelRule?.alwaysListen) return false;

  const serverRule = getServerRule(guildId);
  if (serverRule?.requireMention !== undefined) return serverRule.requireMention;

  return defaultRequirement;
}

export function buildRulesContext(userId: string, channelId: string, guildId: string | null): string {
  const parts: string[] = [];

  if (guildId) {
    const serverRule = getServerRule(guildId);
    if (serverRule?.context) parts.push(serverRule.context);
  } else {
    parts.push('=== CONTEXT: DIRECT MESSAGE ===');
    parts.push('Private DM conversation. Full presence.');
  }

  const channelRule = getChannelRule(channelId);
  if (channelRule?.context) {
    parts.push('');
    parts.push(`=== CHANNEL: ${channelRule.name} ===`);
    parts.push(channelRule.context);
  }

  const userRule = getUserRule(userId);
  if (userRule) {
    parts.push('');
    parts.push(`=== SPEAKING WITH: ${userRule.name} ===`);
    if (userRule.relationship) parts.push(userRule.relationship);
    if (userRule.context) parts.push(userRule.context);
  }

  return parts.join('\n');
}

export function isUserAllowedInServer(userId: string, guildId: string | null): boolean {
  const userRule = getUserRule(userId);
  if (!userRule) return false;

  if (guildId && userRule.blockedServers?.includes(guildId)) return false;

  if (userRule.allowedServers && userRule.allowedServers.length > 0) {
    if (guildId && !userRule.allowedServers.includes(guildId)) return false;
  }

  return true;
}

// --- DB persistence ---

export function getRulesData(): RulesData {
  ensureRulesLoaded();
  return {
    servers: Object.fromEntries(serverRules),
    channels: Object.fromEntries(channelRules),
    users: Object.fromEntries(userRules),
  };
}

export function saveRules(data: RulesData): void {
  setConfig('discord.rules', JSON.stringify(data));
  reloadRules(data);
}

export function reloadRules(data?: RulesData): void {
  const d = data || loadRulesWithFallback();
  serverRules.clear();
  channelRules.clear();
  userRules.clear();
  for (const [k, v] of Object.entries(d.servers)) serverRules.set(k, v);
  for (const [k, v] of Object.entries(d.channels)) channelRules.set(k, v);
  for (const [k, v] of Object.entries(d.users)) userRules.set(k, v);
  console.log(`[Discord Rules] Reloaded: ${serverRules.size} server, ${channelRules.size} channel, ${userRules.size} user rules`);
}
