// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import type { TurnAudience } from './turn-audience.js';
import type { ImageBlockParam, McpServerConfig } from './agent/claude-types.js';
import type { McpServerInfo } from '@aerie/shared';
import type { AgentRuntimeEvent } from './runtimes/types.js';
import { clearAllThreadSessions } from './db.js';
import { registry } from './ws/connection-registry.js';
import type { PushService } from './push.js';
import { getAerieConfig } from '../config.js';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { registerHttpMcpServer } from './tools-bridge.js';
import { getDisabledMcpServers, setDisabledMcpServers, buildMcpStatusWithDisabled } from './agent/agent-mcp-filter.js';
import { PRIORITIES, QueryQueue, AUTONOMOUS_QUEUE_TIMEOUT_MS } from './agent/agent-query-queue.js';
import { createAgentMutableState, hasCodexCompanionLanes, loadCodexSessionsIfNeeded, codexLaneKeysForThread, clearCodexSession } from './agent/agent-state.js';
import { processViaRouter } from './agent/agent-router-query.js';
import { dispatchAgentTurn } from './agent/agent-dispatch.js';
import { listAgentSessions } from './agent/session-list.js';
import { deliverSideNoteToBusySession, busyHeartbeatSessionCount } from './heartbeat/supervisor.js';
import { deliverSideNoteToBusyCodexLane } from './runtimes/codex-side-notes.js';
import type { AgentRouting } from './agent/agent-route-selection.js';

// Lazy-init: config isn't available at import time — defer until first use
let _initialized = false;
let claudeMdContent = '';
let AGENT_CWD = '';
const mcpServersFromConfig: Record<string, McpServerConfig> = {};

function ensureInit() {
  if (_initialized) return;
  _initialized = true;
  const config = getAerieConfig();
  AGENT_CWD = config.agent.cwd;

  // Load CLAUDE.md
  const candidates = [
    config.agent.claude_md_path,
    join(AGENT_CWD, '.claude/CLAUDE.md'),
    join(AGENT_CWD, 'CLAUDE.md'),
  ];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    if (existsSync(candidate)) {
      claudeMdContent = readFileSync(candidate, 'utf-8');
      console.log(`Loaded CLAUDE.md from: ${candidate} (${claudeMdContent.length} chars)`);
      break;
    }
  }

  // Load .mcp.json
  const mcpJsonPath = config.agent.mcp_json_path;
  if (existsSync(mcpJsonPath)) {
    try {
      const mcpJson = JSON.parse(readFileSync(mcpJsonPath, 'utf-8'));
      if (mcpJson.mcpServers) {
        for (const [name, mcpCfg] of Object.entries(mcpJson.mcpServers) as [string, any][]) {
          if (mcpCfg.type === 'url' || mcpCfg.type === 'http') {
            mcpServersFromConfig[name] = { type: 'http', url: mcpCfg.url, headers: mcpCfg.headers };
          } else if (mcpCfg.type === 'sse') {
            mcpServersFromConfig[name] = { type: 'sse', url: mcpCfg.url, headers: mcpCfg.headers };
          } else if (!mcpCfg.type || mcpCfg.type === 'stdio') {
            mcpServersFromConfig[name] = { command: mcpCfg.command, args: mcpCfg.args, env: mcpCfg.env };
          }
        }
        console.log(`Loaded ${Object.keys(mcpServersFromConfig).length} MCP servers from .mcp.json: ${Object.keys(mcpServersFromConfig).join(', ')}`);
      }
    } catch (err) {
      console.warn('Failed to load .mcp.json:', err instanceof Error ? err.message : err);
    }
  }

  // Register HTTP MCP servers with the tools bridge (for API router path)
  if (existsSync(mcpJsonPath)) {
    try {
      const mcpJson = JSON.parse(readFileSync(mcpJsonPath, 'utf-8'));
      if (mcpJson.mcpServers) {
        for (const [name, mcpCfg] of Object.entries(mcpJson.mcpServers) as [string, any][]) {
          if (mcpCfg.type === 'url' || mcpCfg.type === 'http' || mcpCfg.type === 'sse') {
            registerHttpMcpServer(name, mcpCfg.url, mcpCfg.headers);
          }
        }
      }
    } catch { /* already warned above */ }
  }
}

const agentState = createAgentMutableState();
const queryQueue = new QueryQueue();

/** Get current estimated context token usage (for compaction notices) */
export function getContextTokensUsed(): number {
  return agentState.contextTokensUsed;
}

export class AgentService {
  private pushService: PushService | null = null;

  setPushService(service: PushService): void {
    this.pushService = service;
  }

  getPresenceStatus(): 'active' | 'dormant' | 'waking' | 'offline' {
    return agentState.presenceStatus;
  }

  isProcessing(): boolean {
    return queryQueue.isProcessing;
  }

  getQueueDepth(): number {
    return queryQueue.depth;
  }

  getMcpStatus(): McpServerInfo[] {
    // Ensure disabled servers are always shown, even if no query has run yet
    ensureInit(); // Make sure mcpServersFromConfig is loaded
    return buildMcpStatusWithDisabled(agentState.cachedMcpStatus, mcpServersFromConfig);
  }

  /** The Codex app-server thread paired with one Aerie thread, when one has
   *  already been established. `/mcp` uses it to ask the same warm window for
   *  its inventory instead of borrowing the newest Claude transcript. */
  getCodexSessionId(threadId: string | undefined): string | null {
    if (!threadId) return null;
    loadCodexSessionsIfNeeded(agentState);
    // /mcp and /status need an inventory witness, not an arbitrary companion's
    // private transcript. Once a room has companion Codex lanes, returning no
    // thread asks app-server for its daemon-wide catalog instead.
    if (hasCodexCompanionLanes(agentState.codexDaemonSessions, threadId)) return null;
    return agentState.codexDaemonSessions.get(threadId) ?? null;
  }

  /**
   * Drop this room's Codex app-server threads after a withdrawn turn.
   *
   * A reroll or an edit-rerun already nulls the Claude thread session, which is
   * what makes those a genuine rewind on that side. Codex holds its own
   * transcript, so without this the same thread is re-prompted with the removed
   * turns still in its history. Returns how many lanes were cleared.
   */
  clearCodexSessionsForThread(threadId: string): number {
    loadCodexSessionsIfNeeded(agentState);
    const keys = codexLaneKeysForThread(agentState.codexDaemonSessions, threadId);
    for (const key of keys) {
      agentState.codexDaemonSessions.delete(key);
      agentState.codexHandedSequences.delete(key);
      clearCodexSession(key);
    }
    if (keys.length > 0) {
      console.log(`[Agent] Cleared ${keys.length} Codex lane(s) for withdrawn turn in thread ${threadId}`);
    }
    return keys.length;
  }

  stopGeneration(): boolean {
    if (agentState.activeAbortController) {
      agentState.activeAbortController.abort();
      return true;
    }
    for (const runtime of agentState.activeRouterRuntimes.values()) {
      if (runtime.abort()) return true;
    }
    return false;
  }

  /** Abort the in-flight router/CLI turn for a thread (e.g. on message edit). */
  abortThreadGeneration(threadId: string): boolean {
    const rt = agentState.activeRouterRuntimes.get(threadId);
    return rt ? rt.abort() : false;
  }

  async reconnectMcpServer(_name: string): Promise<{ success: boolean; error?: string }> {
    // Warm CLI/Codex sessions own their MCP connections — config changes
    // apply when the next session spawns.
    return { success: false, error: 'No active session — will apply on next message' };
  }

  async toggleMcpServer(name: string, enabled: boolean): Promise<{ success: boolean; error?: string }> {
    try {
      // Persist the disabled state in DB config (works with or without active session)
      const disabledServers = getDisabledMcpServers();
      if (enabled) {
        // Remove from disabled list
        const updated = disabledServers.filter(s => s !== name);
        setDisabledMcpServers(updated);
      } else {
        // Add to disabled list if not already there
        if (!disabledServers.includes(name)) {
          setDisabledMcpServers([...disabledServers, name]);
        }
      }

      // Clear all thread sessions so next query starts fresh with new MCP config
      // (resumed sessions use the original MCP config, not the filtered one)
      clearAllThreadSessions();

      // Update cached status to reflect the change for the UI
      const exists = agentState.cachedMcpStatus.some(s => s.name === name);
      if (exists) {
        agentState.cachedMcpStatus = agentState.cachedMcpStatus.map(s => {
          if (s.name === name) {
            return { ...s, status: enabled ? 'pending' : 'disabled' };
          }
          return s;
        });
      } else if (!enabled && mcpServersFromConfig[name]) {
        // Server not in cache yet but being disabled — add it
        agentState.cachedMcpStatus = [...agentState.cachedMcpStatus, { name, status: 'disabled', toolCount: 0 }];
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async rewindFiles(_userMessageId: string, _dryRun?: boolean): Promise<{ canRewind: boolean; filesChanged?: string[]; insertions?: number; deletions?: number; error?: string }> {
    // File checkpointing was an SDK-lane feature; the warm lanes don't record
    // rewind checkpoints.
    return { canRewind: false, error: 'No active session' };
  }

  async listSessions(limit = 50): Promise<unknown[]> {
    ensureInit();
    try {
      const sessions = await listAgentSessions(AGENT_CWD, limit);
      return sessions;
    } catch (err) {
      console.error('Failed to list sessions:', err);
      return [];
    }
  }

  async processMessage(threadId: string, content: string, threadMeta?: { name: string; type: 'daily' | 'named' | 'treehouse' }, opts?: {
    platform?: 'web' | 'discord' | 'telegram' | 'api';
    platformContext?: string;
    imageBlocks?: ImageBlockParam[];
    discordAuthor?: string;
    /** What the user has just taken back, told to a lane that cannot forget it —
     *  see the note in agent-router-query where this reaches the prompt. */
    withdrawn?: string;
    /** Exact durable room boundary for this inbound turn. */
    inboundSequence?: number;
    /** Who is asking. Set by every path that can carry a non-owner. */
    audience?: TurnAudience;
  }): Promise<string> {
    // Determine priority based on platform
    const platform = opts?.platform || 'web';
    let priority: number;
    if (platform === 'web') {
      priority = PRIORITIES.web_interactive;
    } else if (platform === 'telegram') {
      // Telegram is owner-only — always high priority
      priority = PRIORITIES.discord_owner;
    } else if (platform === 'discord') {
      // Check if it's the owner by inspecting platformContext
      // Discord messages from the owner get higher priority
      const isOwner = opts?.platformContext?.includes('owner');
      priority = isOwner ? PRIORITIES.discord_owner : PRIORITIES.discord_other;
    } else {
      priority = PRIORITIES.web_interactive;
    }

    // A turn already running on the warm CLI session can be reached directly.
    // Without this the message parks in the queue behind the very turn it is
    // trying to answer — so a question asked mid-turn cannot be answered until
    // that turn gives up. Images and non-owner platforms keep the normal path:
    // a side note is text only, and carries no thread of its own.
    // The exactly-one rule is asked ACROSS both lane kinds, not once per kind.
    // Asked per kind, a Claude turn and a Codex turn running at the same moment
    // each look unambiguous from inside their own lane, and whichever is
    // checked first quietly wins — so a note meant for the room the user is standing
    // in can be delivered to the other one. With more than one turn anywhere,
    // nobody takes it and the message goes the normal queued way.
    if (platform === 'web' && !opts?.imageBlocks?.length) {
      const busyLanes = busyHeartbeatSessionCount() + agentState.activeCodexLanes.size;
      if (busyLanes === 1) {
        if (deliverSideNoteToBusySession(content)) return '';
        if (deliverSideNoteToBusyCodexLane(agentState.activeCodexLanes, content)) return '';
      }
    }

    return queryQueue.enqueue(priority, async () => {
      agentState.presenceStatus = 'waking';
      registry.broadcast({ type: 'presence', status: 'waking' });
      return this._processQuery(threadId, content, false, threadMeta, opts);
    });
  }

  /**
   * A wake. `wakeCompanionId` is the companion the bell belongs to, when one is
   * attached — it decides which warm lane answers, so the session that rings is
   * the one that has been in the room. Omitted, the thread default decides,
   * which is what every wake did before bells had owners.
   */
  async processAutonomous(threadId: string, prompt: string, wakeCompanionId?: string): Promise<string> {
    return queryQueue.enqueue(PRIORITIES.autonomous, async () => {
      return this._processQuery(threadId, prompt, true, undefined, undefined, wakeCompanionId);
    }, AUTONOMOUS_QUEUE_TIMEOUT_MS);
  }

  /**
   * Process a query through the ApiRouterRuntime (Ollama, OpenRouter, etc.)
   * Used for non-Claude models — simpler path without SDK features like session resume.
   * History is loaded from DB, streamed to websocket like the SDK path.
   */
  private async _processViaRouter(
    threadId: string,
    content: string,
    model: string,
    systemPrompt: string,
    platform: 'web' | 'discord' | 'telegram' | 'api',
    streamMsgId: string,
    activeCompanionId: string | null,
    platformOpts?: { imageBlocks?: ImageBlockParam[]; discordAuthor?: string; [key: string]: unknown },
    routing: AgentRouting = 'api',
    isAutonomous = false,
  ): Promise<string> {
    return processViaRouter(
      threadId,
      content,
      model,
      systemPrompt,
      platform,
      streamMsgId,
      activeCompanionId,
      {
        getAgentCwd: () => AGENT_CWD,
        agentState,
      },
      platformOpts,
      routing,
      isAutonomous,
    );
  }

  private async _processQuery(threadId: string, content: string, isAutonomous = false, threadMeta?: { name: string; type: 'daily' | 'named' | 'treehouse' }, platformOpts?: { platform?: 'web' | 'discord' | 'telegram' | 'api'; platformContext?: string; imageBlocks?: ImageBlockParam[]; discordAuthor?: string; withdrawn?: string; inboundSequence?: number; audience?: TurnAudience }, wakeCompanionId?: string): Promise<string> {
    return dispatchAgentTurn(
      threadId,
      content,
      isAutonomous,
      threadMeta,
      platformOpts,
      {
        ensureInit,
        getClaudeMdContent: () => claudeMdContent,
        processViaRouter: (
          laneThreadId,
          laneContent,
          laneModel,
          laneSystemPrompt,
          lanePlatform,
          laneStreamMsgId,
          activeCompanionId,
          lanePlatformOpts,
          routing,
          laneIsAutonomous,
        ) => this._processViaRouter(
          laneThreadId,
          laneContent,
          laneModel,
          laneSystemPrompt,
          lanePlatform,
          laneStreamMsgId,
          activeCompanionId,
          lanePlatformOpts,
          routing,
          laneIsAutonomous,
        ),
      },
      wakeCompanionId,
    );
  }
}
