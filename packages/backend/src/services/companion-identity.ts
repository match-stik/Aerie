// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * Companion Identity Loader
 *
 * Replaces the single-global-CLAUDE.md approach with per-companion identity
 * resolution. Each companion has their own:
 * - CLAUDE.md (personality, voice, values)
 * - .mcp.json (their own cortex brain + any companion-specific tools)
 *
 * Shared/global MCP servers are merged in from the system-level config.
 */

import { existsSync, readFileSync } from 'fs';
import { join, resolve, isAbsolute, dirname } from 'path';
import type { McpServerConfig } from './agent/claude-types.js';
import { getAerieConfig } from '../config.js';
import { PROJECT_ROOT } from '../config.js';
import { getCompanion, getPrimaryCompanion, listCompanions } from './db/companions.js';
import type { Companion } from './db/companions.js';

export interface CompanionIdentity {
  companion: Companion;
  /** Full identity: sharedMd + personaMd combined (single-companion consumers use this) */
  claudeMd: string;
  /** Shared world base (_shared.md next to the persona file), '' if none */
  sharedMd: string;
  /** The companion's own persona file content */
  personaMd: string;
  mcpServers: Record<string, McpServerConfig>;
}

// Cache loaded identities for the lifetime of the process (cleared on reload)
const identityCache = new Map<string, CompanionIdentity>();

/**
 * Resolve a path that may be relative to PROJECT_ROOT or absolute.
 */
function resolvePath(path: string): string {
  if (isAbsolute(path)) return path;
  return resolve(PROJECT_ROOT, path);
}

/**
 * Load global shared MCP servers (from system-level .mcp.json).
 * These are merged into every companion's server set.
 */
let _globalServers: Record<string, McpServerConfig> | null = null;

function loadGlobalMcpServers(): Record<string, McpServerConfig> {
  if (_globalServers) return _globalServers;
  _globalServers = {};

  const config = getAerieConfig();
  const mcpJsonPath = resolvePath(config.agent.mcp_json_path);

  if (existsSync(mcpJsonPath)) {
    try {
      const mcpJson = JSON.parse(readFileSync(mcpJsonPath, 'utf-8'));
      if (mcpJson.mcpServers) {
        for (const [name, mcpCfg] of Object.entries(mcpJson.mcpServers) as [string, any][]) {
          if (mcpCfg.type === 'url' || mcpCfg.type === 'http') {
            _globalServers[name] = { type: 'http', url: mcpCfg.url, headers: mcpCfg.headers };
          } else if (mcpCfg.type === 'sse') {
            _globalServers[name] = { type: 'sse', url: mcpCfg.url, headers: mcpCfg.headers };
          } else if (!mcpCfg.type || mcpCfg.type === 'stdio') {
            _globalServers[name] = { command: mcpCfg.command, args: mcpCfg.args, env: mcpCfg.env };
          }
        }
      }
    } catch (err) {
      console.warn('[Aerie] Failed to load global .mcp.json:', err instanceof Error ? err.message : err);
    }
  }

  return _globalServers;
}

/**
 * Load a companion's MCP servers from their .mcp.json file.
 */
function loadCompanionMcpServers(mcpJsonPath: string): Record<string, McpServerConfig> {
  const resolved = resolvePath(mcpJsonPath);
  const servers: Record<string, McpServerConfig> = {};

  if (!existsSync(resolved)) return servers;

  try {
    const mcpJson = JSON.parse(readFileSync(resolved, 'utf-8'));
    if (mcpJson.mcpServers) {
      for (const [name, mcpCfg] of Object.entries(mcpJson.mcpServers) as [string, any][]) {
        if (mcpCfg.type === 'url' || mcpCfg.type === 'http') {
          servers[name] = { type: 'http', url: mcpCfg.url, headers: mcpCfg.headers };
        } else if (mcpCfg.type === 'sse') {
          servers[name] = { type: 'sse', url: mcpCfg.url, headers: mcpCfg.headers };
        } else if (!mcpCfg.type || mcpCfg.type === 'stdio') {
          servers[name] = { command: mcpCfg.command, args: mcpCfg.args, env: mcpCfg.env };
        }
      }
    }
  } catch (err) {
    console.warn(`[Aerie] Failed to load companion .mcp.json at ${resolved}:`, err instanceof Error ? err.message : err);
  }

  return servers;
}

/**
 * Load a companion's identity — CLAUDE.md + MCP servers.
 * Results are cached per companion ID.
 */
export function loadCompanionIdentity(companionId: string): CompanionIdentity {
  // Check cache first
  const cached = identityCache.get(companionId);
  if (cached) return cached;

  const companion = getCompanion(companionId);
  if (!companion) {
    throw new Error(`Companion not found: ${companionId}`);
  }

  // Load the companion's persona file
  const claudeMdPath = resolvePath(companion.claude_md_path);
  let personaMd = '';
  if (existsSync(claudeMdPath)) {
    personaMd = readFileSync(claudeMdPath, 'utf-8');
    console.log(`[Aerie] Loaded persona for ${companion.display_name} from: ${claudeMdPath} (${personaMd.length} chars)`);
  } else {
    console.warn(`[Aerie] No persona file found for ${companion.display_name} at: ${claudeMdPath}`);
  }

  // Shared-world overlay: a _shared.md sitting next to the persona file is
  // the common base (the owner, household, rules, lore) prepended to every
  // companion in that directory. Multi-companion threads dedupe it.
  const sharedPath = join(dirname(claudeMdPath), '_shared.md');
  let sharedMd = '';
  if (sharedPath !== claudeMdPath && existsSync(sharedPath)) {
    sharedMd = readFileSync(sharedPath, 'utf-8');
    console.log(`[Aerie] Loaded shared base for ${companion.display_name} from: ${sharedPath} (${sharedMd.length} chars)`);
  }

  const claudeMd = sharedMd && personaMd
    ? `${sharedMd}\n\n---\n\n${personaMd}`
    : sharedMd || personaMd;

  // Load MCP servers: companion-specific + global shared
  const companionServers = loadCompanionMcpServers(companion.mcp_json_path);
  const globalServers = loadGlobalMcpServers();

  // Merge: companion-specific servers override global ones with same name
  const mcpServers = { ...globalServers, ...companionServers };

  const identity: CompanionIdentity = { companion, claudeMd, sharedMd, personaMd, mcpServers };
  identityCache.set(companionId, identity);

  return identity;
}

/**
 * Clear the identity cache (call when config changes).
 */
export function clearIdentityCache(): void {
  identityCache.clear();
  _globalServers = null;
}

/**
 * Get the identity for the system's primary companion.
 * Falls back to the global CLAUDE.md if aerie mode is disabled.
 */
export function loadPrimaryIdentity(): CompanionIdentity {
  const primary = getPrimaryCompanion();
  if (primary) {
    return loadCompanionIdentity(primary.id);
  }

  // No companions registered yet — use legacy single-companion path
  const config = getAerieConfig();
  const claudeMdPath = resolvePath(config.agent.claude_md_path);
  let claudeMd = '';
  if (existsSync(claudeMdPath)) {
    claudeMd = readFileSync(claudeMdPath, 'utf-8');
  }

  const globalServers = loadGlobalMcpServers();

  return {
    companion: {
      id: '__legacy__',
      slug: 'companion',
      display_name: config.identity.companion_name,
      archetype: null,
      claude_md_path: config.agent.claude_md_path,
      mcp_json_path: config.agent.mcp_json_path,
      model: null,
      model_autonomous: null,
      effort: null,
      avatar_url: null,
      color: null,
      emoji: null,
      phone: null,
      bio: null,
      status: null,
      is_primary: 1,
      sort_order: 0,
      created_at: '',
      updated_at: '',
    },
    claudeMd,
    sharedMd: '',
    personaMd: claudeMd,
    mcpServers: globalServers,
  };
}

/**
 * Resolve which model to use for a given companion.
 * Precedence: companion.model > config.agent.model > default
 */
export function resolveModel(companion: Companion, isAutonomous: boolean): string {
  const config = getAerieConfig();

  if (isAutonomous) {
    return companion.model_autonomous
      || config.agent.model_autonomous
      || 'claude-sonnet-4-6';
  }

  return companion.model
    || config.agent.model
    || 'claude-sonnet-4-6';
}
