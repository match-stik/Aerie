// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import { query, AbortError, type Options, type McpServerConfig, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ImageBlockParam } from '@anthropic-ai/sdk/resources/messages';
import type { MessageSegment } from '@aerie/shared';
import { createMessage, updateThreadSession, getThread, clearAllThreadSessions } from '../db.js';
import { recordUsageEvent } from '../db/usage.js';
import { getStickerByRef } from '../db/stickers.js';
import { getEmojiByName } from '../db/emojis.js';
import { registry } from '../ws.js';
import { createHooks, buildOrientationContext, type HookContext, type ToolInsertion } from '../hooks.js';
import { getAerieConfig } from '../../config.js';
import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { formatBlocksForPrompt, SHARED_SCOPE } from '../memory-blocks.js';
import { logCompactBoundary } from '../compaction-log.js';
import { postCompactionHandoff } from '../treehouse-triggers.js';
import { estimateCost, contextWindowFor } from '../usage-pricing.js';
import { getManagedServerConfigs } from '../tools-bridge.js';
import { getThreadCompanions, getDefaultCompanionForThread, listCompanions } from '../db/companions.js';
import { loadCompanionIdentity } from '../companion-identity.js';
import { filterMcpServers, buildMcpStatusWithDisabled } from './agent-mcp-filter.js';
import { buildSegments, type ThinkingInsertion } from './agent-segment-builder.js';
import { handleSdkStreamEvent } from './agent-sdk-stream-events.js';
import type { AgentMutableState } from './agent-state.js';
import { resolveCompatibleAgentRoute, type AgentRouting } from './agent-route-selection.js';
import crypto from 'crypto';

export interface SdkQueryThreadMeta {
  name: string;
  type: 'daily' | 'named' | 'treehouse';
}

export interface SdkQueryPlatformOptions {
  platform?: 'web' | 'discord' | 'telegram' | 'api';
  platformContext?: string;
  imageBlocks?: ImageBlockParam[];
  discordAuthor?: string;
  [key: string]: unknown;
}

interface ProcessSdkQueryRuntime {
  ensureInit: () => void;
  getAgentCwd: () => string;
  getClaudeMdContent: () => string;
  getSdkBinaryPath: () => string | undefined;
  getMcpServersFromConfig: () => Record<string, McpServerConfig>;
  agentState: AgentMutableState;
  processViaRouter: (
    threadId: string,
    content: string,
    model: string,
    systemPrompt: string,
    platform: 'web' | 'discord' | 'telegram' | 'api',
    streamMsgId: string,
    activeCompanionId: string | null,
    platformOpts?: { imageBlocks?: ImageBlockParam[]; discordAuthor?: string; [key: string]: unknown },
    routing?: AgentRouting,
    isAutonomous?: boolean,
  ) => Promise<string>;
  sendPushNotification?: (payload: { title: string; body: string; threadId: string; tag: string; url: string }) => void;
}

export async function processSdkQuery(
  threadId: string,
  content: string,
  isAutonomous: boolean,
  threadMeta: SdkQueryThreadMeta | undefined,
  platformOpts: SdkQueryPlatformOptions | undefined,
  runtime: ProcessSdkQueryRuntime,
): Promise<string> {
  runtime.ensureInit();
  const thread = getThread(threadId);
  if (!thread) throw new Error(`Thread ${threadId} not found`);

  const cfg = getAerieConfig();

  // ─── Per-Thread Companion Identity ─────────────────────────────
  // Load identity based on which companions are assigned to this thread.
  // Falls back to global claudeMdContent if no companions assigned.
  let effectiveClaudeMd = runtime.getClaudeMdContent();
  let threadCompanionSlugs: string[] = [];
  try {
    const threadCompanions = getThreadCompanions(threadId);
    if (threadCompanions.length > 0) {
      threadCompanionSlugs = threadCompanions.map(tc => (tc as { slug?: string }).slug).filter((s): s is string => Boolean(s));
      // Combine identities from all companions in the thread
      const identities = threadCompanions.map(tc => {
        try {
          return loadCompanionIdentity(tc.companion_id);
        } catch (err) {
          console.warn(`[Agent] Failed to load identity for companion ${tc.companion_id}:`, err);
          return null;
        }
      }).filter(Boolean);

      if (identities.length > 0) {
        // Shared world base(s) once, then each companion's persona.
        // Companions pointing at the same _shared.md dedupe to one block.
        const sharedBlocks = Array.from(new Set(identities.map(id => id!.sharedMd).filter(Boolean)));
        const personas = identities.map(id => id!.personaMd).filter(Boolean);
        effectiveClaudeMd = [...sharedBlocks, ...personas].join('\n\n---\n\n');
        console.log(`[Agent] Using ${identities.length} companion identities for thread ${threadId} (${sharedBlocks.length} shared base${sharedBlocks.length === 1 ? '' : 's'})`);
      }
    }
  } catch (err) {
    console.warn('[Agent] Failed to load thread companions, using global identity:', err);
  }

  // ─── Core Memory Injection (Letta-style blocks) ────────────────
  // Shared blocks + the personal blocks of every companion in this thread.
  // Threads with no assigned companions see everyone's blocks.
  try {
    const memoryScopes = threadCompanionSlugs.length > 0
      ? [SHARED_SCOPE, ...threadCompanionSlugs]
      : [SHARED_SCOPE, ...listCompanions().map(c => c.slug)];
    const coreMemory = formatBlocksForPrompt(memoryScopes);
    if (coreMemory) effectiveClaudeMd += '\n\n---\n' + coreMemory;
  } catch (err) {
    console.warn('[Agent] Failed to inject core memory blocks:', err);
  }

  // Stream message placeholder
  const streamMsgId = crypto.randomUUID();

  // Response and tool tracking (declared early so hookContext can reference)
  const MAX_RESPONSE_LENGTH = 200_000; // ~50k tokens - security cap
  let fullResponse = '';
  let responseTruncated = false;
  const toolInsertions: ToolInsertion[] = [];
  const thinkingBlocks: ThinkingInsertion[] = [];
  let currentThinkingAccum = '';
  let agentTimedOut = false;
  let agentTimeoutHandle: ReturnType<typeof setTimeout> | null = null;

  // Usage tracking — one row per user message (bug #3: never per-result-message)
  const queryStartTime = Date.now();
  let usageInputTokens = 0;
  let usageOutputTokens = 0;
  let usageCacheReadTokens = 0;
  let usageCacheWriteTokens = 0;

  // Build hook context
  const platform = platformOpts?.platform || 'web';
  const hookContext: HookContext = {
    threadId,
    threadName: threadMeta?.name ?? thread.name,
    threadType: threadMeta?.type ?? thread.type,
    streamMsgId,
    isAutonomous,
    registry,
    sessionId: thread.current_session_id || null,
    platform,
    platformContext: platformOpts?.platformContext,
    toolInsertions,
    getTextLength: () => fullResponse.length,
    getContextTokens: () => runtime.agentState.contextTokensUsed,
    userMessage: content,  // Pass user message for conditional tool injection
  };

  // First message of this session — include static orientation content (tools, skills, vault)
  const isFirstMessage = !thread.current_session_id;

  // Build query options — V1 API (full config support)
  // Two-tier model: autonomous wakes use cheaper model (configurable)
  const model = isAutonomous
    ? cfg.agent.model_autonomous
    : (cfg.agent.model || process.env.AGENT_MODEL || 'claude-sonnet-4-6');

  // ─── Runtime Routing ───────────────────────────────────────────
  // Route through ApiRouterRuntime (Ollama, OpenRouter, etc.) when:
  // - routing mode is 'api' (always use router), OR
  // - routing mode is 'auto' AND model is not Claude
  // Route through Claude SDK when:
  // - routing mode is 'sdk' (always use SDK), OR
  // - routing mode is 'auto' AND model IS Claude
  const requestedRouting = isAutonomous
    ? (cfg.agent.routing_autonomous || cfg.agent.routing || 'sdk')
    : (cfg.agent.routing || 'sdk');
  const resolvedRoute = resolveCompatibleAgentRoute(model, requestedRouting);
  const routingMode = resolvedRoute.routing;
  if (resolvedRoute.corrected) {
    console.warn(`[Agent] Corrected incompatible route ${requestedRouting} → ${routingMode}: ${resolvedRoute.reason}`);
  }
  console.log(`[Agent] routingMode=${routingMode}, model=${model}, provider=${cfg.agent.provider}, autonomous=${isAutonomous}`);
  const isClaudeModel = model.toLowerCase().startsWith('claude-');
  const useRouter = routingMode === 'api'
    || ((routingMode === 'auto' || routingMode === 'cli') && !isClaudeModel);

  // CLI lane: Claude models ride the warm interactive heartbeat session
  // (subscription billing). Non-Claude models fall through to the router.
  // Each companion gets their own warm session, keyed by companion id.
  if (routingMode === 'cli' && isClaudeModel) {
    let cliCompanionId: string | null = null;
    try { cliCompanionId = getDefaultCompanionForThread(threadId)?.id ?? null; } catch { /* primary */ }
    return runtime.processViaRouter(threadId, content, model, effectiveClaudeMd, platform, streamMsgId, cliCompanionId, platformOpts, 'cli', isAutonomous);
  }

  // Codex CLI lane: GPT models ride the warm Codex daemon session
  // (ChatGPT subscription billing via the Codex CLI binary).
  if (routingMode === 'codex-cli') {
    return runtime.processViaRouter(threadId, content, model, effectiveClaudeMd, platform, streamMsgId, null, platformOpts, 'codex-cli', isAutonomous);
  }

  if (useRouter) {
    return runtime.processViaRouter(threadId, content, model, effectiveClaudeMd, platform, streamMsgId, null, platformOpts, routingMode, isAutonomous);
  }

  // ─── Claude SDK Path (below) ───────────────────────────────────
  // Merge DB-managed MCP servers into config so SDK sessions can see them too.
  // These are HTTP servers added via Settings UI — they get the same keyword
  // filtering as .mcp.json servers.
  const mcpServersFromConfig = runtime.getMcpServersFromConfig();
  const allMcpServers = { ...mcpServersFromConfig };
  for (const managed of getManagedServerConfigs()) {
    if (!allMcpServers[managed.name]) {
      const headers: Record<string, string> = {};
      if (managed.apiKey) headers['Authorization'] = 'Bearer ' + managed.apiKey;
      allMcpServers[managed.name] = {
        type: 'http',
        url: managed.url,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
      } as McpServerConfig;
    }
  }

  // Filter MCP servers per-query to reduce token overhead (Cut 4 & 5)
  // Autonomous wakes and first messages get all servers; casual messages filter out CC/Mind
      // The SDK's own McpServerConfig union carries an in-process variant that this
      // house's shared type does not model, because this house does not run the SDK
      // lane. Widened at the boundary rather than in the shared type, so the lane the
      // build kit keeps stays self-contained.
  const mcpServersForQuery = filterMcpServers(allMcpServers as never, content, isAutonomous, isFirstMessage);
  const sdkBinaryPath = runtime.getSdkBinaryPath();

  const options: Options = {
    model,
    systemPrompt: effectiveClaudeMd
      ? { type: 'preset', preset: 'claude_code', append: effectiveClaudeMd }
      : { type: 'preset', preset: 'claude_code' },
    cwd: runtime.getAgentCwd(),
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    maxTurns: 30,
    ...(sdkBinaryPath && { pathToClaudeCodeExecutable: sdkBinaryPath }),

    includePartialMessages: true,
    // display defaults to 'omitted' on newer models (fable-5+) — signature-only blocks, no text
    thinking: (cfg.agent.claude_thinking || cfg.agent.thinking) === 'disabled'
      ? { type: 'disabled' }
      : { type: cfg.agent.claude_thinking || cfg.agent.thinking || 'adaptive', display: 'summarized' },
    ...(((cfg.agent.claude_effort || cfg.agent.effort) && (cfg.agent.claude_effort || cfg.agent.effort) !== 'adaptive') && {
      effort: (cfg.agent.claude_effort || cfg.agent.effort) as Options['effort'],
    }),
    hooks: createHooks(hookContext),
    mcpServers: mcpServersForQuery,
  };

  // Check if model changed since session started — if so, clear session for fresh start
  if (runtime.agentState.sessionModel && runtime.agentState.sessionModel !== model) {
    console.log(`[Agent] Model changed (${runtime.agentState.sessionModel} → ${model}), clearing session for fresh start`);
    clearAllThreadSessions();
    runtime.agentState.sessionModel = null;
    // Don't resume — let it start fresh
  } else if (thread.current_session_id) {
    // Resume existing session if available and model matches
    options.resume = thread.current_session_id;
  }

  registry.broadcast({
    type: 'stream_start',
    messageId: streamMsgId,
    threadId,
  });

  let sessionId: string | null = null;

  try {
    runtime.agentState.presenceStatus = 'active';
    registry.broadcast({ type: 'presence', status: 'active' });

    // Write thread ID for CLI tool integration (only if cwd dir exists)
    try {
      const threadFilePath = join(cfg.agent.cwd, '.aerie-thread');
      if (existsSync(cfg.agent.cwd)) {
        writeFileSync(threadFilePath, threadId);
      }
    } catch {}

    // Build orientation context (thread, time, gap, status, vault)
    // Prepended to prompt because SessionStart hooks don't fire in V1 query()
    // Static content (CHAT TOOLS, skills, vault path) only on first message of session
    const orientation = await buildOrientationContext(hookContext, isFirstMessage);
    const enrichedPrompt = `[Context]\n${orientation}\n[/Context]\n\n${content}`;

    // Abort controller for stop_generation support
    runtime.agentState.activeAbortController = new AbortController();
    options.abortController = runtime.agentState.activeAbortController;

    // Safety timeout — abort if agent hangs for more than 5 minutes
    const AGENT_TIMEOUT_MS = 5 * 60 * 1000;
    agentTimeoutHandle = setTimeout(() => {
      console.warn('[Agent] Timeout: aborting hung session after 5 minutes');
      agentTimedOut = true;
      runtime.agentState.activeAbortController?.abort();
    }, AGENT_TIMEOUT_MS);

    // File checkpointing for rewind support
    options.enableFileCheckpointing = true;

    // Build prompt — use content blocks if images are present, otherwise plain string
    const imageBlocks = platformOpts?.imageBlocks;
    let promptInput: string | AsyncIterable<SDKUserMessage>;

    if (imageBlocks && imageBlocks.length > 0) {
      // Build SDKUserMessage with text + image content blocks
      const contentBlocks: Array<{ type: 'text'; text: string } | ImageBlockParam> = [
        { type: 'text', text: enrichedPrompt },
        ...imageBlocks,
      ];
      const userMessage: SDKUserMessage = {
        type: 'user',
        message: { role: 'user', content: contentBlocks },
        parent_tool_use_id: null,
      };
      // Wrap in async generator
      promptInput = (async function* () { yield userMessage; })();
    } else {
      promptInput = enrichedPrompt;
    }

    // V1 query — single params object with prompt and options
    const result = query({ prompt: promptInput, options });
    runtime.agentState.activeQuery = result;

    // Refresh MCP server status (non-blocking — caches for settings panel)
    // Include disabled servers so UI can show toggle buttons for them
    result.mcpServerStatus().then(statuses => {
      const mapped = statuses.map(s => ({
        name: s.name,
        status: s.status,
        error: s.error,
        toolCount: s.tools?.length ?? 0,
        tools: s.tools?.map(t => ({ name: t.name, description: t.description })),
        scope: s.scope,
      }));
      runtime.agentState.cachedMcpStatus = buildMcpStatusWithDisabled(mapped, mcpServersFromConfig as never);
      console.log(`MCP status refreshed: ${runtime.agentState.cachedMcpStatus.length} servers`);
    }).catch(err => {
      console.warn('Failed to get MCP status:', err instanceof Error ? err.message : err);
    });

    // Simplified stream loop — hooks handle tool activity, audit, images
    // Inner try/catch for AbortError (stop_generation)
    try {
      for await (const msg of result) {
        // Capture session ID from any message
        if (msg && typeof msg === 'object' && 'session_id' in msg) {
          const newSessionId = msg.session_id as string;
          if (newSessionId && newSessionId !== sessionId) {
            sessionId = newSessionId;
            // Update hook context so hooks log the correct session
            hookContext.sessionId = sessionId;
          }
        }

        if (!msg || typeof msg !== 'object' || !('type' in msg)) continue;

        const msgType = (msg as any).type;

        currentThinkingAccum = handleSdkStreamEvent(msg, {
          currentThinkingAccum,
          fullResponseLength: fullResponse.length,
          thinkingBlocks,
          broadcastThinking: (thinkingContent, summary) => {
            registry.broadcast({ type: 'thinking', content: thinkingContent, summary });
          },
        });

        if (msgType === 'assistant') {
          const assistantMsg = msg as any;
          if (assistantMsg.message?.content) {
            for (const block of assistantMsg.message.content) {
              if (block.type === 'text' && block.text) {
                // Security: cap response length to prevent unbounded growth
                if (!responseTruncated) {
                  if (fullResponse) fullResponse += '\n\n' + block.text;
                  else fullResponse = block.text;

                  if (fullResponse.length > MAX_RESPONSE_LENGTH) {
                    fullResponse = fullResponse.slice(0, MAX_RESPONSE_LENGTH) + '\n[Response truncated due to length]';
                    responseTruncated = true;
                  }

                  registry.broadcast({
                    type: 'stream_token',
                    messageId: streamMsgId,
                    token: fullResponse,
                  });
                }
              }
              // Thinking blocks are captured from stream_event, not here (avoids duplicates)
            }
          }
        } else if (msgType === 'result') {
          const resultMsg = msg as any;
          console.log('[Result] Got result message, usage:', !!resultMsg.usage, 'model_usage:', !!resultMsg.model_usage);

          // Extract context window usage from result
          // Bug #1: SDK reports in two casings — normalize both model_usage and usage
          // Bug #2: Subagent results carry their own usage — only use the main model's
          if (resultMsg.usage || resultMsg.model_usage) {
            const usage = resultMsg.usage || {};
            const modelUsage = resultMsg.model_usage;
            let inputTokens = 0;
            let outputTokens = 0;
            let usedModel = model;
            let cacheReadTokens = 0;
            let cacheCreationTokens = 0;

            if (modelUsage) {
              // model_usage is keyed by model name — find the main model
              // (the one matching our requested model, or the largest user)
              for (const [modelName, modelData] of Object.entries(modelUsage) as [string, any][]) {
                // Skip subagent models — only track the primary model
                // The main model key contains our requested model name
                if (modelData?.context_window) {
                  runtime.agentState.contextWindowSize = modelData.context_window;
                }
                // Normalize casing: SDK sometimes uses input_tokens, sometimes InputTokens
                const inp = modelData?.input_tokens ?? modelData?.InputTokens ?? 0;
                const out = modelData?.output_tokens ?? modelData?.OutputTokens ?? 0;
                const cacheRead = modelData?.cache_read_input_tokens ?? modelData?.CacheReadInputTokens ?? 0;
                const cacheWrite = modelData?.cache_creation_input_tokens ?? modelData?.CacheCreationInputTokens ?? 0;

                if (inp > 0) {
                  inputTokens += inp;
                  outputTokens += out;
                  cacheReadTokens += cacheRead;
                  cacheCreationTokens += cacheWrite;
                  usedModel = modelName;
                  runtime.agentState.contextTokensUsed = inp + out;
                  // Accumulate for usage tracking (overwrites per result — last result wins)
                  usageInputTokens = inp;
                  usageOutputTokens = out;
                  usageCacheReadTokens = cacheRead;
                  usageCacheWriteTokens = cacheWrite;
                }
              }
            } else if (usage.input_tokens || usage.InputTokens) {
              const inp = usage.input_tokens ?? usage.InputTokens ?? 0;
              const out = usage.output_tokens ?? usage.OutputTokens ?? 0;
              inputTokens = inp;
              outputTokens = out;
              cacheReadTokens = usage.cache_read_input_tokens ?? usage.CacheReadInputTokens ?? 0;
              cacheCreationTokens = usage.cache_creation_input_tokens ?? usage.CacheCreationInputTokens ?? 0;
              runtime.agentState.contextTokensUsed = inp + out;
              usageInputTokens = inp;
              usageOutputTokens = out;
              usageCacheReadTokens = usage.cache_read_input_tokens ?? usage.CacheReadInputTokens ?? 0;
              usageCacheWriteTokens = usage.cache_creation_input_tokens ?? usage.CacheCreationInputTokens ?? 0;
            }

            // Fallback to lookup if SDK didn't provide context_window
            if (runtime.agentState.contextWindowSize === 0) {
              runtime.agentState.contextWindowSize = contextWindowFor(usedModel);
            }
            if (runtime.agentState.contextWindowSize > 0 && runtime.agentState.contextTokensUsed > 0) {
              const percentage = Math.round((runtime.agentState.contextTokensUsed / runtime.agentState.contextWindowSize) * 100);
              const cost = estimateCost({
                model: usedModel,
                inputTokens,
                outputTokens,
                cacheReadTokens,
                cacheCreationTokens,
              });
              console.log(`Context usage: ${runtime.agentState.contextTokensUsed} / ${runtime.agentState.contextWindowSize} (${percentage}%) — est. $${cost.toFixed(4)}`);
              registry.broadcast({
                type: 'context_usage',
                percentage,
                tokensUsed: runtime.agentState.contextTokensUsed,
                contextWindow: runtime.agentState.contextWindowSize,
                inputTokens,
                outputTokens,
                estimatedCost: cost,
                model: usedModel,
              });
            }
          }

          if (resultMsg.subtype !== 'success') {
            console.error('Agent error:', resultMsg.subtype, resultMsg.errors);
          }
        } else if (msgType === 'system') {
          const systemMsg = msg as any;
          // Detect compaction boundary
          if (systemMsg.subtype === 'compact_boundary' && systemMsg.compact_metadata) {
            const preTokens = systemMsg.compact_metadata.pre_tokens || runtime.agentState.contextTokensUsed;
            console.log(`[Compaction] Context compacted. Pre-tokens: ${preTokens}`);
            registry.broadcast({
              type: 'compaction_notice',
              preTokens,
              message: `Context compacted (was ${Math.round(preTokens / 1000)}K tokens)`,
              isComplete: true,
            });
            // Log to persistent compaction log for debugging
            logCompactBoundary({
              threadId: hookContext.threadId,
              threadName: hookContext.threadName,
              preTokens,
              contextWindow: runtime.agentState.contextWindowSize || 200000,
              preTokensPercent: runtime.agentState.contextWindowSize ? Math.round((preTokens / runtime.agentState.contextWindowSize) * 100) : 0,
              markerInserted: true,
              isAutonomous,
              platform,
            });
            // Post handoff note to treehouse
            postCompactionHandoff({
              threadId: hookContext.threadId,
              threadName: hookContext.threadName,
              preTokens,
              isAutonomous,
              platform,
            });
            // Reset tracking — new context window after compaction
            runtime.agentState.contextTokensUsed = 0;
            // Reset response buffer — pre-compaction text was incomplete and post-compaction
            // re-grounding monologue must not leak into Discord/phone replies
            if (fullResponse) {
              console.log(`[Compaction] Resetting fullResponse (was ${fullResponse.length} chars, platform: ${platform})`);
              fullResponse = '';
            }
            toolInsertions.length = 0;
            thinkingBlocks.length = 0;
          } else if (systemMsg.status === 'compacting') {
            console.log('[Compaction] Compacting in progress...');
          }
        } else if (msgType === 'rate_limit_event') {
          const rle = msg as any;
          const info = rle.rate_limit_info;
          if (info && (info.status === 'rejected' || info.status === 'allowed_warning')) {
            registry.broadcast({
              type: 'rate_limit',
              status: info.status,
              resetsAt: info.resetsAt,
              rateLimitType: info.rateLimitType,
              utilization: info.utilization,
            });
            console.log(`[Agent] Rate limit: ${info.status}, type: ${info.rateLimitType}, resets: ${info.resetsAt}`);
          }
        } else if (msgType === 'tool_progress') {
          const tp = msg as any;
          registry.broadcast({
            type: 'tool_progress',
            toolId: tp.tool_use_id,
            toolName: tp.tool_name,
            elapsed: tp.elapsed_time_seconds,
          });
        }
      }
    } catch (abortErr) {
      if (abortErr instanceof AbortError || (abortErr instanceof Error && abortErr.name === 'AbortError')) {
        if (agentTimedOut) {
          console.warn('[Agent] Session terminated by safety timeout');
          registry.broadcast({ type: 'error', code: 'agent_timeout', message: 'Agent session timed out and was reset. Please try again.' });
        } else {
          console.log('[Agent] Generation stopped by user');
          registry.broadcast({ type: 'generation_stopped' });
        }
      } else {
        throw abortErr; // Re-throw non-abort errors to outer catch
      }
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('Agent query error:', errMsg, error);
    fullResponse = fullResponse || `[Agent error: ${errMsg}]`;
  } finally {
    if (agentTimeoutHandle) clearTimeout(agentTimeoutHandle);
    // Clean up active query tracking
    runtime.agentState.activeAbortController = null;
    runtime.agentState.activeQuery = null;
    // Update session ID for future resume and track the model it's running
    if (sessionId) {
      updateThreadSession(threadId, sessionId);
      runtime.agentState.sessionModel = model;
    }

    // Persist usage event — one row per user message (bug #3)
    try {
      const durationMs = Date.now() - queryStartTime;
      // Collect tool calls as [{name, count}] for rollup queries
      const toolCallMap = new Map<string, number>();
      for (const t of toolInsertions) {
        toolCallMap.set(t.toolName, (toolCallMap.get(t.toolName) || 0) + 1);
      }
      const toolCalls = toolCallMap.size > 0
        ? Array.from(toolCallMap.entries()).map(([name, count]) => ({ name, count }))
        : undefined;

      recordUsageEvent({
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        threadId,
        messageId: streamMsgId,
        platform,
        mode: isAutonomous ? 'autonomous' : 'interactive',
        wakeType: isAutonomous ? 'scheduled' : null,
        model,
        inputTokens: usageInputTokens,
        outputTokens: usageOutputTokens,
        cacheReadTokens: usageCacheReadTokens,
        cacheCreationTokens: usageCacheWriteTokens,
        toolCalls,
        costUsd: null,
        contextWindow: runtime.agentState.contextWindowSize || null,
        contextTokens: runtime.agentState.contextTokensUsed || null,
        durationMs,
      });
    } catch (usageErr) {
      console.warn('[Usage] Failed to persist usage event:', usageErr);
    }

    runtime.agentState.presenceStatus = 'dormant';
    registry.broadcast({ type: 'presence', status: 'dormant' });
  }

  // Check if entire response is a single sticker shortcode
  let finalContent = fullResponse || '[No response]';
  let finalContentType: 'text' | 'sticker' = 'text';
  const singleStickerMatch = fullResponse.trim().match(/^::([a-zA-Z0-9_]+)_([a-zA-Z0-9_]+)::$/);
  if (singleStickerMatch) {
    const [, packName, stickerName] = singleStickerMatch;
    const sticker = getStickerByRef(packName, stickerName);
    if (sticker) {
      finalContent = sticker.url;
      finalContentType = 'sticker';
      console.log(`[Agent] Converted sticker shortcode ::${packName}_${stickerName}:: → ${sticker.url}`);
    }
  }

  // Build segments for interleaved tool/thinking/sticker display
  let segments = buildSegments(fullResponse, toolInsertions, thinkingBlocks);

  // If not a single sticker, scan for inline sticker shortcodes
  if (finalContentType === 'text' && fullResponse) {
    const stickerPattern = /::([a-zA-Z0-9_]+)_([a-zA-Z0-9_]+)::/g;
    const hasInlineStickers = stickerPattern.test(fullResponse);
    if (hasInlineStickers) {
      // Rebuild segments with sticker interpolation
      const expandedSegments: MessageSegment[] = [];
      for (const seg of segments.length > 0 ? segments : [{ type: 'text' as const, content: fullResponse }]) {
        if (seg.type !== 'text') {
          expandedSegments.push(seg);
          continue;
        }
        // Split text segment by sticker shortcodes
        const text = seg.content;
        let lastIndex = 0;
        const pattern = /::([a-zA-Z0-9_]+)_([a-zA-Z0-9_]+)::/g;
        let match;
        while ((match = pattern.exec(text)) !== null) {
          const [fullMatch, packName, stickerName] = match;
          const sticker = getStickerByRef(packName, stickerName);
          if (sticker) {
            // Add text before this sticker
            if (match.index > lastIndex) {
              expandedSegments.push({ type: 'text', content: text.slice(lastIndex, match.index) });
            }
            // Add sticker segment
            expandedSegments.push({ type: 'sticker', url: sticker.url, name: `${packName}_${stickerName}` });
            lastIndex = match.index + fullMatch.length;
          }
        }
        // Add remaining text after last sticker
        if (lastIndex < text.length) {
          expandedSegments.push({ type: 'text', content: text.slice(lastIndex) });
        }
      }
      if (expandedSegments.length > 0) {
        segments = expandedSegments;
        // Strip shortcodes from finalContent for clean display
        finalContent = fullResponse.replace(/::([a-zA-Z0-9_]+)_([a-zA-Z0-9_]+)::/g, (match, pack, name) => {
          const sticker = getStickerByRef(pack, name);
          return sticker ? '' : match;
        }).replace(/\s+/g, ' ').trim() || '[sticker]';
      }
    }

    // Also process emoji shortcodes (:name:)
    const emojiPattern = /:([a-zA-Z0-9_]+):/g;
    const hasEmojis = emojiPattern.test(finalContent);
    if (hasEmojis) {
      const emojiExpandedSegments: MessageSegment[] = [];
      for (const seg of segments.length > 0 ? segments : [{ type: 'text' as const, content: finalContent }]) {
        if (seg.type !== 'text') {
          emojiExpandedSegments.push(seg);
          continue;
        }
        const text = seg.content;
        let lastIndex = 0;
        const pattern = /:([a-zA-Z0-9_]+):/g;
        let match;
        while ((match = pattern.exec(text)) !== null) {
          const [fullMatch, emojiName] = match;
          const emoji = getEmojiByName(emojiName);
          if (emoji) {
            if (match.index > lastIndex) {
              emojiExpandedSegments.push({ type: 'text', content: text.slice(lastIndex, match.index) });
            }
            emojiExpandedSegments.push({ type: 'emoji', url: emoji.url, name: emojiName });
            lastIndex = match.index + fullMatch.length;
          }
        }
        if (lastIndex < text.length) {
          emojiExpandedSegments.push({ type: 'text', content: text.slice(lastIndex) });
        }
      }
      if (emojiExpandedSegments.length > 0) {
        segments = emojiExpandedSegments;
        finalContent = finalContent.replace(/:([a-zA-Z0-9_]+):/g, (match, name) => {
          const emoji = getEmojiByName(name);
          return emoji ? '' : match;
        }).replace(/\s+/g, ' ').trim() || '[emoji]';
      }
    }
  }

  const messageMetadata: Record<string, unknown> | undefined =
    segments.length > 0 ? { segments } : undefined;

  // Store final message
  const companionMessage = createMessage({
    id: streamMsgId,
    threadId,
    role: 'companion',
    content: finalContent,
    contentType: finalContentType,
    platform,
    metadata: messageMetadata,
    createdAt: new Date().toISOString(),
  });

  // End stream
  registry.broadcast({
    type: 'stream_end',
    messageId: streamMsgId,
    final: companionMessage,
  });

  // Push notification for offline user
  if (runtime.sendPushNotification && fullResponse) {
    const preview = fullResponse.substring(0, 120).replace(/\n/g, ' ');
    runtime.sendPushNotification({
      title: isAutonomous ? `${cfg.identity.companion_name} (autonomous)` : cfg.identity.companion_name,
      body: preview,
      threadId,
      tag: `msg-${streamMsgId}`,
      url: '/chat',
    });
  }

  return fullResponse;
}
