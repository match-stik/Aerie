// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Command system — registry for the dropdown, handlers for UI-only commands.
// Skills and custom commands pass through to the model lane as prompt text.
// /compact and /clear pass through only on the SDK lane, which implements them;
// anywhere else they would arrive as an ordinary message, so they refuse.

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import crypto from 'crypto';
import type { CommandRegistryEntry, ServerMessage } from '@aerie/shared';
import {
  getDb,
  getThread,
  createThread,
  getMessages,
  listThreads,
  getActiveTriggers,
  listTriggers,
} from './db.js';
import { AgentService } from './agent.js';
import { Orchestrator } from './orchestrator.js';
import { getAerieConfig, PROJECT_ROOT } from '../config.js';
import { persistAgentModelSelection } from './agent-settings.js';
import { localModelIds, nearestModelIds, routingHasLocalCatalog } from './model-catalog.js';
import {
  classifyCodexMcpStatus,
  readAllHeldServers,
  readLaneMcpInventory,
  readLiveMcpStatus,
  summarizeCodexMcpStatus,
  summarizeLaneMcp,
  summarizeMcpLive,
  summarizeSessionMcp,
} from './mcp-live.js';
import { resolveCompatibleAgentRoute, type AgentRouting } from './agent/agent-route-selection.js';
import { projectKeyForDir, readSessionUsage } from './agent/session-list.js';
import { readCodexMcpStatus } from './runtimes/codex-daemon.js';
import type { ConnectionRegistry } from '../types.js';

// ---------------------------------------------------------------------------
// Skill scanning (structured data for the registry)
// ---------------------------------------------------------------------------

interface SkillInfo {
  name: string;
  description: string;
  dirName: string;
}

let skillsCache: { skills: SkillInfo[]; scannedAt: number } | null = null;
const SKILLS_CACHE_MS = 60 * 1000;

function scanSkills(): SkillInfo[] {
  const config = getAerieConfig();
  const skillsDir = join(config.agent.cwd, '.claude', 'skills');

  if (skillsCache && (Date.now() - skillsCache.scannedAt) < SKILLS_CACHE_MS) {
    return skillsCache.skills;
  }

  try {
    if (!existsSync(skillsDir)) return [];

    const entries = readdirSync(skillsDir, { withFileTypes: true });
    const skills: SkillInfo[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillFile = join(skillsDir, entry.name, 'SKILL.md');
      if (!existsSync(skillFile)) continue;

      const content = readFileSync(skillFile, 'utf-8');
      const fm = content.match(/^---\n([\s\S]*?)\n---/)?.[1] || '';
      const nameMatch = fm.match(/^name:\s*(.+)$/m);
      const descMatch = fm.match(/^description:\s*(.+)$/m);
      if (!nameMatch) continue;

      skills.push({
        name: nameMatch[1].trim(),
        description: descMatch ? descMatch[1].trim() : '',
        dirName: entry.name,
      });
    }

    skillsCache = { skills, scannedAt: Date.now() };
    return skills;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Custom command scanning (.claude/commands/*.md)
// ---------------------------------------------------------------------------

let customCommandCache: { commands: { name: string; description: string }[]; scannedAt: number } | null = null;

function scanCustomCommands(): { name: string; description: string }[] {
  const config = getAerieConfig();
  const commandsDir = join(config.agent.cwd, '.claude', 'commands');

  if (customCommandCache && (Date.now() - customCommandCache.scannedAt) < SKILLS_CACHE_MS) {
    return customCommandCache.commands;
  }

  try {
    if (!existsSync(commandsDir)) return [];

    const entries = readdirSync(commandsDir).filter(f => f.endsWith('.md'));
    const commands: { name: string; description: string }[] = [];

    for (const filename of entries) {
      const content = readFileSync(join(commandsDir, filename), 'utf-8');
      const fm = content.match(/^---\n([\s\S]*?)\n---/)?.[1] || '';
      const name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim() || filename.replace('.md', '');
      const desc = fm.match(/^description:\s*(.+)$/m)?.[1]?.trim() || '';
      commands.push({ name, description: desc });
    }

    customCommandCache = { commands, scannedAt: Date.now() };
    return commands;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// UI-only commands (handled server-side, never touch the agent)
// ---------------------------------------------------------------------------

const UI_COMMANDS: CommandRegistryEntry[] = [
  { name: 'new', description: 'Create a new named thread', category: 'builtin', args: '[name]' },
  { name: 'rename', description: 'Rename the current thread', category: 'builtin', args: '[name]' },
  { name: 'model', description: 'Switch the active model', category: 'builtin', args: '[model]' },
  { name: 'status', description: 'System status — uptime, MCP, queue', category: 'builtin' },
  { name: 'cost', description: 'Token usage for the current session', category: 'builtin' },
  { name: 'mcp', description: 'MCP server connection status', category: 'builtin' },
  { name: 'triggers', description: 'List active triggers and watchers', category: 'builtin' },
  { name: 'retry', description: 'Retry the last message', category: 'builtin' },
  { name: 'wake', description: 'Trigger a manual wake cycle', category: 'builtin', args: '[type]' },
  { name: 'stop', description: 'Stop the current generation', category: 'builtin', clientOnly: true },
  { name: 'help', description: 'Show all available commands', category: 'builtin', clientOnly: true },
];

// SDK-handled commands. The SDK client implements these itself, so on that
// lane they are correctly passed straight through as prompt text and the
// client acts on them.
//
// On any other lane there is no client to act on them, and passing them
// through means they arrive as an ordinary message — so /compact reaches a
// companion as the literal word "/compact" and they answer it, wondering what
// was meant. They stay in the registry because the archive still ships the SDK
// lane and they genuinely work there; what changes is that off that lane they
// now say so instead of quietly becoming conversation.
const SDK_COMMANDS: CommandRegistryEntry[] = [
  { name: 'compact', description: 'Compact the conversation context (SDK lane only)', category: 'builtin' },
  { name: 'clear', description: 'Clear conversation and start fresh (SDK lane only)', category: 'builtin' },
];

const SDK_COMMAND_NAMES = new Set(SDK_COMMANDS.map(c => c.name));

/**
 * What the lane this house is actually running can do about the commands in
 * this file. The runtimes declare capabilities of their own, but those live on
 * an instance built per turn and a command has to answer before any turn
 * exists — so the same facts are stated here, keyed by routing.
 */
function laneFacts(): { routing: string; handlesSdkCommands: boolean; managesMcp: boolean } {
  const cfg = getAerieConfig();
  const routing = resolveCompatibleAgentRoute(cfg.agent.model, cfg.agent.routing || 'sdk').routing;
  return {
    routing,
    handlesSdkCommands: routing === 'sdk',
    // The warm CLI lanes own their MCP servers — the session loads them itself
    // and the backend never sees the connection. cachedMcpStatus is only ever
    // written by the enable/disable buttons, so off these lanes it reports
    // configuration and would count zero connected forever.
    managesMcp: routing === 'sdk' || routing === 'api',
  };
}

/** Newest transcript across every warm heartbeat lane. /cost is asked from a
 *  thread, and a thread does not know which lane answered it, so the freshest
 *  file is the closest honest answer to "this session". */
function latestHeartbeatTranscript(): { path: string; size: number; mtime: number } | null {
  const root = join(homedir(), '.claude', 'projects');
  const lanesDir = join(PROJECT_ROOT, 'data', 'heartbeat');
  let lanes: string[];
  try { lanes = readdirSync(lanesDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); }
  catch { return null; }

  let latest: { path: string; size: number; mtime: number } | null = null;
  for (const lane of lanes) {
    const dir = join(root, projectKeyForDir(join(lanesDir, lane)));
    if (!existsSync(dir)) continue;
    try {
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.jsonl')) continue;
        const p = join(dir, f);
        const st = statSync(p);
        if (!latest || st.mtimeMs > latest.mtime) latest = { path: p, size: st.size, mtime: st.mtimeMs };
      }
    } catch { /* unreadable lane dir — skip it */ }
  }
  return latest;
}

const LANE_LABEL: Record<string, string> = {
  cli: 'the warm Claude CLI lane',
  'codex-cli': 'the warm Codex CLI lane',
  api: 'the API lane',
  sdk: 'the SDK lane',
  auto: 'the auto-routed lane',
};

function laneName(routing: string): string {
  return LANE_LABEL[routing] || `the ${routing} lane`;
}

// ---------------------------------------------------------------------------
// Registry builder (populates the dropdown)
// ---------------------------------------------------------------------------

export function buildCommandRegistry(): CommandRegistryEntry[] {
  const registry: CommandRegistryEntry[] = [...UI_COMMANDS, ...SDK_COMMANDS];

  for (const skill of scanSkills()) {
    registry.push({
      name: skill.dirName,
      description: skill.description.length > 120
        ? skill.description.substring(0, 120) + '...'
        : skill.description,
      category: 'skill',
    });
  }

  for (const cmd of scanCustomCommands()) {
    registry.push({
      name: cmd.name,
      description: cmd.description.length > 120
        ? cmd.description.substring(0, 120) + '...'
        : cmd.description,
      category: 'custom',
    });
  }

  return registry;
}

// ---------------------------------------------------------------------------
// Command dispatch
// ---------------------------------------------------------------------------

export interface CommandServices {
  agent: AgentService;
  orchestrator?: Orchestrator;
  registry: ConnectionRegistry;
}

const UI_COMMAND_NAMES = new Set(UI_COMMANDS.filter(c => !c.clientOnly).map(c => c.name));

export async function handleCommand(
  name: string,
  args: string | undefined,
  threadId: string | undefined,
  services: CommandServices,
): Promise<ServerMessage> {
  try {
    // A command that cannot do its job here says so, rather than falling
    // through to the pass-through below and becoming a message to a companion.
    const lane = laneFacts();
    if (SDK_COMMAND_NAMES.has(name) && !lane.handlesSdkCommands) {
      return {
        type: 'command_result',
        name,
        success: false,
        error: `/${name} is handled by the SDK client. This house runs ${laneName(lane.routing)}, which manages its own context — nothing happened.`,
        display: 'toast',
      };
    }

    if (UI_COMMAND_NAMES.has(name)) {
      switch (name) {
        case 'new': return handleNew(args);
        case 'rename': return handleRename(threadId, args);
        case 'model': return handleModel(args);
        case 'status': return await handleStatus(services, lane, threadId);
        case 'cost': return await handleCost(lane);
        case 'mcp': return handleMcp(services, lane, threadId);
        case 'triggers': return handleTriggers();
        case 'retry': return await handleRetry(threadId, services);
        case 'wake': return await handleWake(args, services);
      }
    }

    // Everything else — pass through to the model lane as prompt text
    if (!threadId) {
      return { type: 'command_result', name, success: false, error: 'No active thread', display: 'toast' };
    }

    const prompt = args ? `/${name} ${args}` : `/${name}`;
    const thread = getThread(threadId);
    await services.agent.processMessage(
      threadId,
      prompt,
      thread ? { name: thread.name, type: thread.type } : undefined,
      { platform: 'web' },
    );

    return { type: 'command_result', name, success: true, display: 'silent' };
  } catch (err) {
    return {
      type: 'command_result',
      name,
      success: false,
      error: err instanceof Error ? err.message : String(err),
      display: 'toast',
    };
  }
}

// ---------------------------------------------------------------------------
// UI command handlers
// ---------------------------------------------------------------------------

function handleNew(args: string | undefined): ServerMessage {
  const name = args?.trim();
  if (!name) {
    return { type: 'command_result', name: 'new', success: false, error: 'Usage: /new [thread name]', display: 'toast' };
  }

  const thread = createThread({
    id: crypto.randomUUID(),
    name,
    type: 'named',
    createdAt: new Date().toISOString(),
  });

  return {
    type: 'command_result',
    name: 'new',
    success: true,
    data: { threadId: thread.id, message: `Thread "${thread.name}" created` },
    display: 'toast',
  };
}

function handleRename(threadId: string | undefined, args: string | undefined): ServerMessage {
  const newName = args?.trim();
  if (!newName) {
    return { type: 'command_result', name: 'rename', success: false, error: 'Usage: /rename [new name]', display: 'toast' };
  }
  if (!threadId) {
    return { type: 'command_result', name: 'rename', success: false, error: 'No active thread', display: 'toast' };
  }

  const thread = getThread(threadId);
  if (!thread) {
    return { type: 'command_result', name: 'rename', success: false, error: 'Thread not found', display: 'toast' };
  }

  getDb().prepare('UPDATE threads SET name = ? WHERE id = ?').run(newName, threadId);

  return {
    type: 'command_result',
    name: 'rename',
    success: true,
    data: { message: `Renamed "${thread.name}" to "${newName}"` },
    display: 'toast',
  };
}

function handleModel(args: string | undefined): ServerMessage {
  const modelId = args?.trim();
  if (!modelId) {
    // getAerieConfig is the one the dispatcher reads, so it is the one that
    // answers "what am I running". This used to prefer the DB row, which meant
    // that after a failed switch it reported the model it had failed to set.
    return {
      type: 'command_result',
      name: 'model',
      success: true,
      data: { message: `Current model: ${getAerieConfig().agent.model}` },
      display: 'toast',
    };
  }

  // Refuse an id the CLI is going to reject, BEFORE writing it anywhere.
  //
  // This used to take any string. `opus 4.5` — the name off the picker, where
  // the id is `claude-opus-4-5` — was written to the row, aerie.yaml and
  // memory, the lane recycled onto it, and the CLI exited code 1 on launch and
  // was relaunched every two seconds. No error reached the screen, because the
  // thing that would have shown one was the thing that could not start.
  //
  // Only refuse where the whole list is known locally. On `api` and `auto` the
  // providers are discovered at request time, so an id we cannot name may well
  // be real, and refusing it would be inventing knowledge we do not have.
  const routing = laneFacts().routing;
  if (routingHasLocalCatalog(routing)) {
    const known = localModelIds();
    if (!known.includes(modelId)) {
      const near = nearestModelIds(modelId, known);
      return {
        type: 'command_result',
        name: 'model',
        success: false,
        data: {
          message: near.length
            ? `No model id "${modelId}". Did you mean ${near.join(', ')}? Nothing was changed.`
            : `No model id "${modelId}". Type /model on its own for the list, or add it under models.extra_claude. Nothing was changed.`,
        },
        display: 'toast',
      };
    }
  }

  // Model and warm lane are one selection. Persist both halves when the new
  // model belongs to the other warm runtime; otherwise every later turn has
  // to repair the same stale route before it can answer.
  const selectedRouting = persistAgentModelSelection(
    modelId,
    (getAerieConfig().agent.routing || 'cli') as AgentRouting,
  );

  return {
    type: 'command_result',
    name: 'model',
    success: true,
    data: {
      message: routingHasLocalCatalog(selectedRouting)
        ? `Model switched to ${modelId}`
        // Say plainly that it went through unchecked, so a lane that will not
        // come back is not a mystery — and say the true reason for THIS lane.
        // The SDK does not discover anything; it simply accepts any valid
        // model string, which is a different fact with the same consequence.
        : selectedRouting === 'sdk'
          ? `Model switched to ${modelId} — not checked against a list, the SDK accepts any valid model string.`
          : `Model switched to ${modelId} — not checked against a list, ${selectedRouting} discovers its models at request time.`,
    },
    display: 'toast',
  };
}

async function handleStatus(
  services: CommandServices,
  lane: ReturnType<typeof laneFacts>,
  threadId: string | undefined,
): Promise<ServerMessage> {
  const mem = process.memoryUsage();
  const orchestratorTasks = services.orchestrator ? await services.orchestrator.getStatus() : [];
  const mcpServers = services.agent.getMcpStatus();
  const uptimeH = Math.floor(process.uptime() / 3600);
  const uptimeM = Math.floor((process.uptime() % 3600) / 60);
  const connected = mcpServers.filter(s => s.status === 'connected').length;

  // Off the lanes the backend connects for, its list is EMPTY rather than
  // merely unmarked — it printed "MCP: 0" on a lane holding a dozen working
  // servers. The lane's own transcript knows which ones it could not use, so
  // report that instead of a count of nothing.
  let mcpPart: string;
  if (lane.routing === 'codex-cli') {
    // Codex owns a different MCP catalog from Claude. Read it from the live
    // app-server, preferably against this thread's warm daemon session; never
    // substitute the newest Claude transcript just because it is readable.
    const live = await readCodexMcpStatus(services.agent.getCodexSessionId(threadId) || undefined);
    if (!live) {
      mcpPart = 'MCP: Codex inventory unavailable';
    } else {
      const state = classifyCodexMcpStatus(live);
      const pieces = [`${state.ready.length} in hand`];
      if (state.needsAuth.length) pieces.push(`${state.needsAuth.length} need sign-in`);
      if (state.unavailable.length) pieces.push(`${state.unavailable.length} did not load`);
      if (state.appFamilies.length) pieces.push(`${state.appFamilies.length} Codex app families`);
      mcpPart = `MCP: ${pieces.join(', ')}`;
    }
  } else if (lane.managesMcp) {
    mcpPart = `MCP: ${connected}/${mcpServers.length}`;
  } else {
    // Count what this window HOLDS. The old line counted absences and called
    // them failures; a server this session never attempted is not a shut door.
    // Includes the brain, which arrives by the house road and leaves no line in
    // the CLI's logs — so a list built from those alone could never show it.
    const mine = await readAllHeldServers();
    const failed = mine?.filter(s => s.verdict === 'failed').length ?? 0;
    const held = mine?.filter(s => s.verdict === 'connected').length ?? 0;
    if (!mine?.length) mcpPart = 'MCP: lane-managed (no session record yet)';
    else mcpPart = failed ? `MCP: ${held} in hand, ${failed} would not open` : `MCP: ${held} in hand`;
  }

  const message = [
    `Lane: ${lane.routing}`,
    `Uptime: ${uptimeH}h ${uptimeM}m`,
    `Mem: ${Math.round(mem.heapUsed / 1024 / 1024)}MB`,
    `Presence: ${services.agent.getPresenceStatus()}`,
    mcpPart,
    `Queue: ${services.agent.getQueueDepth()}`,
    `Tasks: ${orchestratorTasks.length}`,
  ].join(' | ');

  return {
    type: 'command_result',
    name: 'status',
    success: true,
    data: { message },
    display: 'toast',
  };
}

/**
 * What this session has actually cost. On a warm CLI lane the figures come
 * from the transcript the CLI writes for itself — the same read the context
 * meter and the Sessions cards use — because that lane reports nothing per
 * request. Per session is the only unit they are honest in: every turn
 * re-sends the whole conversation, so prompt sizes cannot be added up.
 *
 * This used to be a fixed sentence pointing at the context bar, which hides
 * itself below 50% — so on a quiet window it pointed at nothing.
 */
async function handleCost(lane: ReturnType<typeof laneFacts>): Promise<ServerMessage> {
  if (lane.routing !== 'cli') {
    return {
      type: 'command_result',
      name: 'cost',
      success: true,
      data: { message: `Per-request tokens for ${laneName(lane.routing)} are in Status > Usage.` },
      display: 'toast',
    };
  }

  const file = latestHeartbeatTranscript();
  const usage = file ? await readSessionUsage(file.path, file.size, file.mtime) : undefined;
  if (!usage) {
    return {
      type: 'command_result',
      name: 'cost',
      success: false,
      error: 'No transcript for this lane yet — nothing to count.',
      display: 'toast',
    };
  }

  const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
  const message = [
    `${usage.replies} replies`,
    `${k(usage.outputTokens)} written`,
    `${k(usage.contextTokens)} context`,
    `${k(usage.cacheReadTokens)} off cache`,
    usage.model || '',
  ].filter(Boolean).join(' | ');

  return { type: 'command_result', name: 'cost', success: true, data: { message }, display: 'toast' };
}

async function handleMcp(
  services: CommandServices,
  lane: ReturnType<typeof laneFacts>,
  threadId: string | undefined,
): Promise<ServerMessage> {
  const servers = services.agent.getMcpStatus();
  if (lane.routing === 'codex-cli') {
    const live = await readCodexMcpStatus(services.agent.getCodexSessionId(threadId) || undefined);
    return {
      type: 'command_result',
      name: 'mcp',
      success: true,
      data: {
        message: live === null
          ? 'Codex live MCP inventory unavailable — no Claude lane was substituted.'
          : summarizeCodexMcpStatus(live),
      },
      display: 'toast',
    };
  }
  if (!lane.managesMcp) {
    // What this window actually holds, by name: a list of what we can see
    // rather than a count of what we cannot. That count was wrong, too: it
    // reported seven working servers as needing a sign-in when this session
    // had simply never attempted them.
    //
    // Cortex is in here too. It is not an MCP server on this lane — the backend
    // calls the worker directly — so it left no line in the CLI's logs and was
    // absent from the one screen opened to see what is connected.
    const mine = await readAllHeldServers();
    if (mine?.length) {
      return {
        type: 'command_result',
        name: 'mcp',
        success: true,
        data: { message: summarizeSessionMcp(mine) },
        display: 'toast',
      };
    }
    // No per-session log yet (a lane that has not finished waking). The
    // transcript still knows what did NOT arrive.
    const inv = readLaneMcpInventory();
    if (inv) {
      return {
        type: 'command_result',
        name: 'mcp',
        success: true,
        data: { message: summarizeLaneMcp(inv) },
        display: 'toast',
      };
    }
    // No transcript to read — fall back to asking the CLI, which at least
    // reaches the servers, and say which reading this is.
    const live = await readLiveMcpStatus();
    if (live) {
      return {
        type: 'command_result',
        name: 'mcp',
        success: true,
        data: { message: `${summarizeMcpLive(live)} — reachable from this box; this lane's own list was unreadable` },
        display: 'toast',
      };
    }
    // Never dress configuration up as a reading. If the live check could not
    // run, the fallback has to say which answer this is.
    return {
      type: 'command_result',
      name: 'mcp',
      success: true,
      data: {
        message: `Live check unavailable — showing what is CONFIGURED, not what is connected: ${servers.length} on ${laneName(lane.routing)}. ${servers.map(s => s.name).join(', ')}`,
      },
      display: 'toast',
    };
  }
  const lines = servers.map(s => {
    const icon = s.status === 'connected' ? 'ok' : s.status;
    return `${s.name}: ${icon} (${s.toolCount} tools)`;
  });

  return {
    type: 'command_result',
    name: 'mcp',
    success: true,
    data: { message: lines.join(' | ') || 'No MCP servers configured' },
    display: 'toast',
  };
}

function handleTriggers(): ServerMessage {
  const active = getActiveTriggers();
  const all = listTriggers();
  const message = all.length === 0
    ? 'No triggers set'
    : `${active.length} active / ${all.length} total — ${all.map(t => `${t.label} (${t.kind}, ${t.status})`).join(', ')}`;

  return {
    type: 'command_result',
    name: 'triggers',
    success: true,
    data: { message },
    display: 'toast',
  };
}

async function handleRetry(threadId: string | undefined, services: CommandServices): Promise<ServerMessage> {
  if (!threadId) {
    return { type: 'command_result', name: 'retry', success: false, error: 'No active thread', display: 'toast' };
  }

  const msgs = getMessages({ threadId, limit: 20 });
  const lastUserMsg = [...msgs].reverse().find(m => m.role === 'user');
  if (!lastUserMsg) {
    return { type: 'command_result', name: 'retry', success: false, error: 'No message found to retry', display: 'toast' };
  }

  const thread = getThread(threadId);
  await services.agent.processMessage(
    threadId,
    lastUserMsg.content,
    thread ? { name: thread.name, type: thread.type } : undefined,
    { platform: 'web', inboundSequence: lastUserMsg.sequence },
  );

  return { type: 'command_result', name: 'retry', success: true, display: 'silent' };
}

async function handleWake(args: string | undefined, services: CommandServices): Promise<ServerMessage> {
  if (!services.orchestrator) {
    return { type: 'command_result', name: 'wake', success: false, error: 'Orchestrator not running', display: 'toast' };
  }

  const wakeType = args?.trim() || 'manual';
  await services.orchestrator.triggerManualWake(wakeType);

  return {
    type: 'command_result',
    name: 'wake',
    success: true,
    data: { message: `Wake cycle triggered (${wakeType})` },
    display: 'toast',
  };
}
