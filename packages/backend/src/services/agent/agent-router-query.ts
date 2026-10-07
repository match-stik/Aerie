// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import { isTurnAudience, guestToolRefusal } from '../turn-audience.js';
import type { ImageBlockParam } from './claude-types.js';
import { shouldReportRuntimeError } from './runtime-error-report.js';
import crypto from 'crypto';
import { createRuntime, type ApiRouterOptions, type ConversationMessage } from '../runtimes/index.js';
import type { DoneEvent, RuntimeTurnInput } from '../runtimes/types.js';
import { createMessage, getMessages, updateThreadActivity } from '../db.js';
import { recordUsageEvent } from '../db/usage.js';
import { registry } from '../ws/connection-registry.js';
import { getAerieConfig } from '../../config.js';
import { getRouterTools, executeRouterTool } from '../tools-bridge.js';
import { getCompanion, getThreadCompanions, listCompanions } from '../db/companions.js';
import { roomVoicesFor, type RoomVoices } from '../heartbeat/room-voices.js';
import { companionTurnEffort } from './companion-effort.js';
import { buildSegments, type ThinkingInsertion } from './agent-segment-builder.js';
import type { ToolInsertion } from '../hooks.js';
import type { AgentMutableState } from './agent-state.js';
import {
  clearCodexSession,
  codexLaneKey,
  persistCodexHandedSequence,
  persistCodexSideNoteOffset,
  persistCodexSession,
  loadCodexSessionsIfNeeded,
} from './agent-state.js';
import { codexSessionDisposition } from './codex-session-policy.js';
import { selectCodexCatchUpHistory } from './codex-catch-up.js';
import { CODEX_THOUGHT_CARD_INSTRUCTIONS } from '../runtimes/codex-thought-card.js';
import { CODEX_OPERATING_CONTRACT } from '../runtimes/codex-operating-contract.js';
import { formatCodexSideNoteHandover, readCodexSideNotesFrom } from '../runtimes/codex-side-notes.js';
import { effectiveAgentProvider, type AgentRouting } from './agent-route-selection.js';
import { getPushService } from '../push.js';
import { buildCompanionPush } from '../push-notify.js';

interface RouterQueryRuntimeContext {
  getAgentCwd: () => string;
  agentState: AgentMutableState;
}

/**
 * The room a Discord turn is landing in — which channel, which server, the
 * rules that apply to this user, and the last few messages said around it.
 *
 * The Discord gateway has always built this and handed it down as
 * platformContext. Only the Agent SDK lane ever read it, so retiring that lane
 * quietly cut the wire: every Discord reply since has been written without the
 * channel history assembled for it. Only Discord carries one — the phone and
 * Telegram have no surrounding room to describe.
 */
export function platformFrameFor(
  platform: 'web' | 'discord' | 'telegram' | 'api',
  platformContext: unknown,
): string {
  if (platform !== 'discord') return '';
  if (typeof platformContext !== 'string' || !platformContext.trim()) return '';
  return `${platformContext}\n\n=== MESSAGE ===\n`;
}

export async function processViaRouter(
  threadId: string,
  content: string,
  model: string,
  systemPrompt: string,
  platform: 'web' | 'discord' | 'telegram' | 'api',
  streamMsgId: string,
  activeCompanionId: string | null,
  runtimeContext: RouterQueryRuntimeContext,
  platformOpts?: { imageBlocks?: ImageBlockParam[]; discordAuthor?: string; [key: string]: unknown },
  routing: AgentRouting = 'api',
  isAutonomous = false,
): Promise<string> {
  const queryStartTime = Date.now();

  // History loader — pull recent messages from DB for context
  const historyLoader = (tid: string, limit: number): ConversationMessage[] => {
    const msgs = getMessages({ threadId: tid, limit });
    // Synthetic system lines (refusal/timeout notices) are UI furniture —
    // they must not re-enter recycle seeds or router history.
    return msgs.filter((m) => m.role !== 'system').map((m) => ({
      role: m.role as 'user' | 'companion',
      content: m.content,
      createdAt: m.created_at,
      authorName: m.companion_id ? (getCompanion(m.companion_id)?.display_name ?? null) : null,
    }));
  };

  // Strip codex/ prefix if present — CodexRuntime uses the bare model id
  const effectiveModel = model.startsWith('codex/') ? model.slice(6) : model;

  // API and Claude paths use Aerie's in-process + HTTP tool bridge. The warm
  // Codex daemon loads and executes its own MCP/apps inventory; discovering a
  // second list here only prints a count the active model never receives.
  const routerTools = routing === 'codex-cli' ? [] : await getRouterTools();
  if (routing === 'codex-cli') {
    console.log(`[Router] Codex daemon owns tools for ${effectiveModel}`);
  } else {
    console.log(`[Router] ${routerTools.length} tools available for ${effectiveModel}`);
  }

  // A guest turn gets NO router tools. Unlike the CLI gate (hooks/gate.cjs),
  // which can let a guest read a narrow set of paths, the router/SDK/Codex tool
  // bridge has no safe read-only subset — shell_exec, codex_exec, the memory
  // writes and read_file are all powerful — so this fails closed. Today Discord
  // guests are answered by the gated CLI lane; this is the guard for the day the
  // interactive model is ever a router or SDK one instead.
  const turnAudience = isTurnAudience(platformOpts?.audience) ? platformOpts.audience : undefined;
  const guardedExecuteTool: typeof executeRouterTool = async (name, args) =>
    guestToolRefusal(turnAudience, name) ?? executeRouterTool(name, args);

  const routerOptions: ApiRouterOptions = {
    loadHistory: historyLoader,
    threadId,
    historyLimit: 50,
    tools: routerTools,
    executeTool: guardedExecuteTool,
  };

  const cfg = getAerieConfig();
  const effectiveProvider = effectiveAgentProvider(effectiveModel, routing, cfg.agent.provider);
  let heartbeatThreadLaneKeys: string[] | undefined;
  if (routing === 'cli') {
    try {
      heartbeatThreadLaneKeys = [...new Set([
        'primary',
        ...(activeCompanionId ? [activeCompanionId] : []),
        ...getThreadCompanions(threadId).map((companion) => companion.companion_id),
      ])];
    } catch {
      // No roster means no safe cross-lane claim. The missed-message net then
      // keeps its one-way rule and reports anything this lane cannot prove.
      heartbeatThreadLaneKeys = undefined;
    }
  }
  // The shared lane writes every voice in the house, so a room holding only
  // some of them has to say so in the turn itself (heartbeat/room-voices.ts).
  // A companion's own lane writes only that companion and needs no line.
  let roomVoices: RoomVoices | null = null;
  if (routing === 'cli' && !activeCompanionId) {
    try {
      roomVoices = roomVoicesFor(
        getThreadCompanions(threadId).map((c) => ({
          id: c.companion_id,
          name: (c as { display_name?: string }).display_name || '',
        })),
        listCompanions().map((c) => ({ id: c.id, name: c.display_name })),
      );
    } catch {
      roomVoices = null;
    }
  }

  const pinnedCodexHistory = Array.isArray(platformOpts?._codexHistorySnapshot)
    ? platformOpts._codexHistorySnapshot as Array<{ role: 'user' | 'assistant'; content: string }>
    : null;

  // Check for existing Codex daemon session to resume (lazy-load sessions from DB on first access)
  loadCodexSessionsIfNeeded(runtimeContext.agentState);
  const codexSessionKey = codexLaneKey(threadId, activeCompanionId);
  const existingCodexSession = runtimeContext.agentState.codexDaemonSessions.get(codexSessionKey);
  const codexTail = routing === 'codex-cli'
    ? getMessages({ threadId, limit: 50 })
    : [];
  const explicitHandThrough = Number(platformOpts?.inboundSequence);
  const liveInboundSequence = Number.isSafeInteger(explicitHandThrough) && explicitHandThrough >= 0
    ? explicitHandThrough
    : undefined;
  const handThroughSequence = liveInboundSequence !== undefined
    ? liveInboundSequence
    : codexTail.at(-1)?.sequence;
  const lastHandedSequence = runtimeContext.agentState.codexHandedSequences.get(codexSessionKey);
  const resumeHistory = routing === 'codex-cli' && existingCodexSession && handThroughSequence !== undefined
    ? selectCodexCatchUpHistory(codexTail, lastHandedSequence, handThroughSequence, 30, liveInboundSequence)
    : [];
  if (routing === 'codex-cli' && existingCodexSession) {
    console.log(`[Router] Resuming Codex daemon session: ${existingCodexSession} (lane ${codexSessionKey})`);
  }

  // Anything the owner sent into the last turn that the lane never picked up live.
  // Handed over before the turn opens, exactly like the Claude lane, so a note
  // written into a busy lane is at worst late and never lost. The offset only
  // advances once the notes are actually in hand.
  let codexSideNoteHandover = '';
  let codexSideNoteHandoverOffset: number | undefined;
  if (routing === 'codex-cli') {
    runtimeContext.agentState.activeCodexLanes.add(codexSessionKey);
    const priorOffset = runtimeContext.agentState.codexSideNoteOffsets.get(codexSessionKey) ?? 0;
    const pending = readCodexSideNotesFrom(codexSessionKey, priorOffset);
    if (pending.notes.length > 0) {
      codexSideNoteHandover = formatCodexSideNoteHandover(pending.notes);
      codexSideNoteHandoverOffset = pending.newOffset;
    }
  }

  console.log(`[Router] createRuntime: routing=${routing}, model=${effectiveModel}`);

  const runtime = await createRuntime(routing, effectiveModel, routerOptions, {
    provider: effectiveProvider,
    codexOptions: {
      loadHistory: historyLoader,
      threadId,
      historyLimit: 50,
      tools: routerTools,
      executeTool: guardedExecuteTool,
    },
    codexDaemonOptions: {
      model: effectiveModel,  // Pass model to Codex CLI daemon
      // The house rules first, then the thought card. Both lanes now know the
      // same things about the house; only the transport differs.
      developerInstructions: `${CODEX_OPERATING_CONTRACT}\n\n${CODEX_THOUGHT_CARD_INSTRUCTIONS}`,
      resumeThreadId: existingCodexSession,  // Resume warm session if exists
      resumeHistory,
      aerieThreadId: threadId,  // For loading history on recovery
      onTurnHanded: () => {
        if (codexSideNoteHandoverOffset !== undefined) {
          const priorOffset = runtimeContext.agentState.codexSideNoteOffsets.get(codexSessionKey);
          if (priorOffset !== codexSideNoteHandoverOffset) {
            runtimeContext.agentState.codexSideNoteOffsets.set(codexSessionKey, codexSideNoteHandoverOffset);
            persistCodexSideNoteOffset(codexSessionKey, codexSideNoteHandoverOffset);
          }
        }
        if (handThroughSequence !== undefined) {
          const priorSequence = runtimeContext.agentState.codexHandedSequences.get(codexSessionKey);
          if (priorSequence === undefined || priorSequence < handThroughSequence) {
            runtimeContext.agentState.codexHandedSequences.set(codexSessionKey, handThroughSequence);
            persistCodexHandedSequence(codexSessionKey, handThroughSequence);
          }
        }
      },
      loadHistory: async (tid: string, limit: number) => {
        if (pinnedCodexHistory) return pinnedCodexHistory.slice(-limit);
        const msgs = getMessages({ threadId: tid, limit });
        return msgs
          .filter((m) => m.role !== 'system')
          .map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          }));
      },
    },
    cliOptions: {
      sessionKey: activeCompanionId || 'primary',
      userName: platformOpts?.discordAuthor || cfg.identity.user_name,
      audience: turnAudience,
      companionName:
        (activeCompanionId ? getCompanion(activeCompanionId)?.display_name : null)
        ?? cfg.identity.companion_name,
      loadHistory: historyLoader,
      threadId,
      threadLaneKeys: heartbeatThreadLaneKeys,
      roomVoices,
      historyLimit: 30,
    },
  });

  runtimeContext.agentState.activeRouterRuntimes.set(threadId, runtime);

  registry.broadcast({
    type: 'stream_start',
    messageId: streamMsgId,
    threadId,
  });

  let fullResponse = '';
  /** The message currently being streamed; a mid-turn break starts a new one. */
  let activeMsgId = streamMsgId;
  /** Bubbles already closed and delivered this turn. */
  let brokenMessages = 0;
  let finishReason: DoneEvent['finishReason'] = 'complete';
  let runtimeError: string | null = null;
  const toolInsertions: ToolInsertion[] = [];
  const thinkingBlocks: ThinkingInsertion[] = [];
  const attachments: Array<{
    fileId: string; filename: string; mimeType: string;
    size: number; contentType: 'image' | 'audio' | 'file'; url: string;
  }> = [];
  let routerInputTokens = 0;
  let routerOutputTokens = 0;
  let routerCacheReadTokens = 0;
  // Runtimes have always reported this; the row hardcoded 0, so Cache Writes
  // read zero on the dashboard for every lane, not just the CLI one.
  let routerCacheWriteTokens = 0;
  let routerContextWindow = 0;
  let routerContextTokens = 0;
    let pendingCodexSessionId: string | null = null;

  try {
    runtimeContext.agentState.presenceStatus = 'active';
    registry.broadcast({ type: 'presence', status: 'active' });

    // A reroll or an edit-rerun deletes rows from the owner's screen and, on the SDK
    // lane, drops the cached session so the next turn genuinely never saw them.
    // A warm CLI session has no such rewind — the transcript only grows.
    //
    // So the note states what changed on the OWNER'S side and stops there. It does not
    // ask a companion to pretend, because they cannot, and because a reroll is
    // very often a tap nobody meant: the whole reason this house keeps the
    // memory is that it once put a conversation back after an accidental one.
    const withdrawn = routing === 'cli' && typeof platformOpts?.withdrawn === 'string'
      ? `[${platformOpts.withdrawn}]\n\n`
      : '';

    // Reconnected here rather than in the gateway, because this is the one
    // place every lane's prompt is built.
    const platformFrame = platformFrameFor(platform, platformOpts?.platformContext);

    const input = {
      // The handover leads, because a note the owner sent into a busy lane is older
      // than the message now arriving and reads as nonsense underneath it.
      prompt: (codexSideNoteHandover ? codexSideNoteHandover + '\n\n' : '')
        + platformFrame + withdrawn + content,
      model: effectiveModel,
      provider: effectiveProvider,
      systemPrompt,
      cwd: runtimeContext.getAgentCwd(),
      thinking: (routing === 'codex-cli'
        ? 'adaptive'
        : (cfg.agent.claude_thinking || cfg.agent.thinking || 'adaptive')) as 'adaptive' | 'enabled' | 'disabled',
      // Their own dial when they have one, the house road-dial when they don't.
      // The lane keeper resolves this through the same function, because a
      // disagreement here recycles their warm lane on every turn.
      effort: companionTurnEffort(
        activeCompanionId ? (getCompanion(activeCompanionId) ?? null) : null,
        routing,
        cfg,
      ) as RuntimeTurnInput['effort'],
      serviceTier: (routing === 'codex-cli'
        ? (cfg.agent.codex_speed || 'standard')
        : 'standard') as RuntimeTurnInput['serviceTier'],
      maxTurns: 30,
      isAutonomous,
      abortController: new AbortController(),
      imageBlocks: platformOpts?.imageBlocks as RuntimeTurnInput['imageBlocks'],
    };

    for await (const event of runtime.runTurn(input)) {
      switch (event.type) {
        case 'session':
          if (routing === 'codex-cli' && event.sessionId) {
            pendingCodexSessionId = event.sessionId;
            console.log(`[Router] Candidate Codex daemon session: ${event.sessionId} for thread ${threadId}`);
          }
          break;


        case 'text_delta':
          fullResponse += event.text;
          registry.broadcast({
            type: 'stream_token',
            messageId: activeMsgId,
            // Phone streaming state is cumulative (matching the SDK lane),
            // so mid-turn Codex commentary and later final text keep their
            // offsets and do not replace one another live.
            token: fullResponse,
          });
          break;

        case 'thinking_end':
          thinkingBlocks.push({
            textOffset: fullResponse.length,
            content: event.fullText,
            summary: event.fullText.slice(0, 100),
          });
          registry.broadcast({
            type: 'thinking',
            content: event.fullText,
            summary: event.fullText.slice(0, 100),
          });
          break;

        case 'tool_start': {
          toolInsertions.push({
            textOffset: fullResponse.length,
            toolId: event.toolUseId,
            toolName: event.toolName,
            input: JSON.stringify(event.input),
          });
          // Live tool chip in the UI while the turn is still streaming —
          // mirrors the SDK lane's hook broadcasts.
          const inp = event.input as Record<string, unknown>;
          const summary =
            typeof inp?.detail === 'string' ? inp.detail
            : typeof inp?.command === 'string' ? inp.command
            : typeof inp?.file_path === 'string' ? inp.file_path
            : JSON.stringify(inp ?? {}).slice(0, 160);
          registry.broadcast({
            type: 'tool_use',
            toolId: event.toolUseId,
            toolName: event.toolName,
            input: summary.slice(0, 160),
            isComplete: false,
            textOffset: fullResponse.length,
          });
          break;
        }

        case 'tool_result':
          // Update matching tool insertion
          for (const t of toolInsertions) {
            if (t.toolId === event.toolUseId) {
              t.output = event.output;
              t.isError = event.isError;
            }
          }
          registry.broadcast({
            type: 'tool_result',
            toolId: event.toolUseId,
            output: (event.output || '').slice(0, 2000),
            isError: event.isError,
          });
          break;

        case 'attachment':
          attachments.push({
            fileId: event.fileId,
            filename: event.filename,
            mimeType: event.mimeType,
            size: event.size,
            contentType: event.contentType,
            url: event.url,
          });
          break;

        case 'message_break': {
          // A lane that comes up for air mid-turn closes the bubble here so it
          // reaches the room now. Everything after this belongs to a new
          // message: text, tool chips, thought cards and attachments all reset,
          // because their offsets are relative to the message they live in.
          if (!fullResponse.trim() && attachments.length === 0) break;
          const brokenSegments = buildSegments(fullResponse, toolInsertions, thinkingBlocks);
          const brokenMessage = createMessage({
            id: activeMsgId,
            threadId,
            role: 'companion',
            content: fullResponse.trim(),
            platform,
            companionId: activeCompanionId || undefined,
            metadata: (brokenSegments.length > 0 || attachments.length > 0)
              ? {
                  ...(brokenSegments.length > 0 && { segments: brokenSegments }),
                  ...(attachments.length > 0 && { attachments: [...attachments] }),
                }
              : undefined,
            createdAt: new Date().toISOString(),
          });
          registry.broadcast({ type: 'stream_end', messageId: activeMsgId, final: brokenMessage });
          brokenMessages++;
          fullResponse = '';
          toolInsertions.length = 0;
          thinkingBlocks.length = 0;
          attachments.length = 0;
          activeMsgId = crypto.randomUUID();
          registry.broadcast({ type: 'stream_start', messageId: activeMsgId, threadId });
          break;
        }

        case 'usage':
          routerInputTokens = event.inputTokens || 0;
          routerOutputTokens = event.outputTokens || 0;
          routerCacheReadTokens = event.cacheReadTokens || 0;
          routerCacheWriteTokens = event.cacheWriteTokens || 0;
          routerContextWindow = event.contextWindow || 0;
          routerContextTokens = event.contextTokens || 0;
          break;

        case 'tool_progress':
          registry.broadcast({
            type: 'tool_progress', toolId: event.toolUseId,
            toolName: event.toolName, elapsed: event.elapsed,
          });
          break;

        case 'rate_limit':
          registry.broadcast({
            type: 'rate_limit', status: event.status,
            resetsAt: event.resetsAt ? Number(event.resetsAt) : undefined,
            rateLimitType: event.rateLimitType, utilization: event.utilization,
          });
          break;

        case 'error':
          // Console-only errors were the dead-air bug (2026-06-12 outage:
          // 3.2h of refused turns invisible to the user) — remember the
          // error so it can land in the thread as a visible system line.
          console.error(`[Router] Error: ${event.message}`);
          runtimeError = event.message;
          break;

        case 'done':
          finishReason = event.finishReason;
          break;
      }
    }
  } catch (err) {
    console.error('[Router] Runtime error:', err);
    if (!fullResponse && !runtimeError) {
      runtimeError = err instanceof Error ? err.message : String(err);
    }
  } finally {
    console.log(`[Router] Turn complete: fullResponse=${fullResponse.length} chars, tools=${toolInsertions.length}, thinking=${thinkingBlocks.length}, error=${runtimeError || 'none'}`);
    if (routing === 'codex-cli') {
      const disposition = codexSessionDisposition({
        finishReason,
        runtimeError,
        hasResponse: fullResponse.trim().length > 0 || attachments.length > 0,
        pendingSessionId: pendingCodexSessionId,
        existingSessionId: existingCodexSession || null,
        isAutonomous,
      });
      if (disposition.action === 'commit' || disposition.action === 'preserve') {
        const verb = disposition.action === 'commit' ? 'Committing' : 'Preserving';
        console.log(`[Router] ${verb} Codex daemon session: ${disposition.sessionId} for lane ${codexSessionKey}`);
        runtimeContext.agentState.codexDaemonSessions.set(codexSessionKey, disposition.sessionId);
        persistCodexSession(codexSessionKey, disposition.sessionId);
      } else if (disposition.sessionId) {
        console.log(`[Router] Clearing Codex daemon session after failed turn: ${disposition.sessionId} for lane ${codexSessionKey}`);
        runtimeContext.agentState.codexDaemonSessions.delete(codexSessionKey);
        runtimeContext.agentState.codexHandedSequences.delete(codexSessionKey);
        clearCodexSession(codexSessionKey);
      }
    }
    if (runtimeContext.agentState.activeRouterRuntimes.get(threadId) === runtime) {
      runtimeContext.agentState.activeRouterRuntimes.delete(threadId);
    }
    // Released here rather than on success: a lane that died mid-turn is not
    // reachable either, and leaving the key behind would send the owner's next note
    // into a file nobody is going to open.
    runtimeContext.agentState.activeCodexLanes.delete(codexSessionKey);
    try {
      await runtime.dispose?.();
    } catch (disposeErr) {
      console.warn(`[Router] Failed to dispose ${runtime.name} runtime:`, disposeErr);
    }
    runtimeContext.agentState.presenceStatus = 'dormant';
    registry.broadcast({ type: 'presence', status: 'dormant' });
  }

  // Retracted turn (e.g. message edited mid-flight) — close the stream
  // without persisting a companion message.
  // A turn the owner STOPPED is not automatically a turn with nothing to say. If it
  // died with a runtime error, this branch used to run first and the stop threw
  // away the one sentence that explained what had happened — and stopping it is
  // exactly what a person does when a turn has hung, which made the silence
  // self-inflicting. See shouldReportRuntimeError.
  if (finishReason === 'aborted' && !fullResponse.trim()
      && !shouldReportRuntimeError(fullResponse, runtimeError)) {
    registry.broadcast({ type: 'generation_stopped' });
    return '';
  }

  // Silence-sentinel support remains as emergency plumbing even though no
  // interactive or wake contract offers it as a choice. If an old or manually
  // driven lane emits one, close the stream without posting a bubble rather
  // than leaking the sentinel to the owner. (Distinct from a timeout, which surfaces
  // as an error.)
  //
  // Two shapes, because two runtimes report it differently. A runtime that
  // passes the sentinel through as text is caught by the string; the
  // interactive-CLI runtime strips it at the outbox line (so a late reply
  // sharing the batch can't leak it) and reports the reason instead. The
  // emptiness check keeps a late reply that rode along with a quiet wake:
  // that turn is silent AND carrying someone's owed words, and the words win.
  const deliberateSilence =
    fullResponse.trim() === '[SILENT]' ||
    (finishReason === 'silent' && !fullResponse.trim() && attachments.length === 0);
  if (deliberateSilence) {
    registry.broadcast({ type: 'generation_stopped' });
    return '';
  }

  // A turn that produced nothing but an error becomes a visible system
  // line instead of a '[No response]' companion bubble — refusals and
  // timeouts must be seen in the room, not buried in the server log.
  if (shouldReportRuntimeError(fullResponse, runtimeError)) {
    const sysMsg = createMessage({
      id: crypto.randomUUID(),
      threadId,
      role: 'system',
      content: `⚠ ${runtimeError}`,
      createdAt: new Date().toISOString(),
    });
    registry.broadcast({ type: 'message', message: sysMsg });
    registry.broadcast({ type: 'generation_stopped' });
    return '';
  }

  // Every chunk already landed as its own message and the tail is empty, so
  // there is no trailing bubble to post — only the open stream to close.
  // Without this a chunked turn would end with a '[No response]' bubble.
  if (brokenMessages > 0 && !fullResponse.trim() && attachments.length === 0) {
    registry.broadcast({ type: 'generation_stopped' });
    return '';
  }

  // Store final message
  // An attachment-only turn (e.g. Codex built-in image_gen with no caption) is
  // a real reply — don't stamp it with the [No response] placeholder.
  const finalContent = fullResponse.trim() || (attachments.length > 0 ? '' : '[No response]');
  const segments = buildSegments(fullResponse, toolInsertions, thinkingBlocks);
  const messageMetadata: Record<string, unknown> | undefined =
    (segments.length > 0 || attachments.length > 0)
      ? { ...(segments.length > 0 && { segments }), ...(attachments.length > 0 && { attachments }) }
      : undefined;
  const companionMessage = createMessage({
    id: activeMsgId,
    threadId,
    role: 'companion',
    content: finalContent,
    platform,
    companionId: activeCompanionId || undefined,
    metadata: messageMetadata,
    createdAt: new Date().toISOString(),
  });

  registry.broadcast({
    type: 'stream_end',
    messageId: activeMsgId,
    final: companionMessage,
  });

  // Notify the owner's phone when they aren't looking at the app. sendIfOffline checks
  // for a live connection first, so this stays silent while they're in the room.
  try {
    const pushService = getPushService();
    if (pushService) {
      const payload = buildCompanionPush({
        content: finalContent,
        threadId,
        hasAttachment: attachments.length > 0,
        fallbackCompanionId: activeCompanionId || undefined,
      });
      if (payload) {
        pushService.sendIfOffline(payload).catch(err =>
          console.error('Companion push error:', err));
      }
    }
  } catch (err) {
    console.error('Companion push build error:', err);
  }

  // Persist usage event
  try {
    const durationMs = Date.now() - queryStartTime;
    recordUsageEvent({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      threadId,
      messageId: activeMsgId,
      platform,
      mode: isAutonomous ? 'autonomous' : 'interactive',
      wakeType: isAutonomous ? 'scheduled' : null,
      model,
      inputTokens: routerInputTokens,
      outputTokens: routerOutputTokens,
      cacheReadTokens: routerCacheReadTokens,
      cacheCreationTokens: routerCacheWriteTokens,
      toolCalls: toolInsertions.length > 0
        ? toolInsertions.map(t => ({ name: t.toolName, count: 1 }))
        : undefined,
      costUsd: null,
      contextWindow: routerContextWindow || null,
      // A snapshot when the runtime can give one. Adding the turn's own input
      // and cache-read together is NOT a context: both are per-turn totals
      // across every re-send, so a tool-heavy turn produced "Ctx 723%" — a real
      // count of tokens re-sent, and a nonsense answer to how full the window
      // is. Left as the old sum only for runtimes that report no snapshot, so
      // nothing that was working goes blank.
      contextTokens: routerContextTokens || (routerInputTokens + routerCacheReadTokens),
      durationMs,
    });
  } catch (usageErr) {
    console.warn('[Usage] Failed to persist usage event:', usageErr);
  }

  updateThreadActivity(threadId, new Date().toISOString(), true);
  return finalContent;
}
