// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * Runtime abstraction layer — normalized event interface for inference providers.
 *
 * agent.ts consumes AgentRuntimeEvent iterables regardless of whether
 * the backing provider is the warm Claude CLI lane, Codex, Ollama, OpenRouter, etc.
 *
 * Each runtime implementation translates provider-specific responses into this
 * common event stream. This keeps agent.ts clean and makes routing mode switching
 * a single constructor swap rather than branching logic.
 */

import type { McpServerConfig } from '../agent/claude-types.js';

// ─── Event types ─────────────────────────────────────────────────────

export type AgentRuntimeEvent =
  | TextDeltaEvent
  | ThinkingDeltaEvent
  | ThinkingEndEvent
  | ToolStartEvent
  | ToolResultEvent
  | ToolProgressEvent
  | UsageEvent
  | CompactionEvent
  | RateLimitEvent
  | SessionEvent
  | AttachmentEvent
  | MessageBreakEvent
  | DoneEvent
  | ErrorEvent;

export interface TextDeltaEvent {
  type: 'text_delta';
  text: string;
}

export interface ThinkingDeltaEvent {
  type: 'thinking_delta';
  text: string;
}

export interface ThinkingEndEvent {
  type: 'thinking_end';
  fullText: string;
}

export interface ToolStartEvent {
  type: 'tool_start';
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface ToolResultEvent {
  type: 'tool_result';
  toolUseId: string;
  toolName: string;
  output: string;
  isError: boolean;
}

export interface ToolProgressEvent {
  type: 'tool_progress';
  toolUseId: string;
  toolName: string;
  elapsed: number;
}

export interface UsageEvent {
  type: 'usage';
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  contextWindow: number;
  /** How full the window was when the turn finished — a SNAPSHOT, not a sum.
   *
   *  The four fields above are what this turn ADDED, and adding them together
   *  does not describe a context: a turn re-sends the whole conversation once
   *  per assistant message, so thirty tool calls means thirty re-sends, and the
   *  cache-read total alone can run to several times the window. Reported as a
   *  percentage that reads "723%", which is a true count of re-sent tokens and
   *  a meaningless answer to "how full is it".
   *
   *  A runtime that can see the end of its own conversation reports that here
   *  and the row uses it. One that cannot leaves it out. */
  contextTokens?: number;
}

export interface CompactionEvent {
  type: 'compaction';
  preTokens: number;
}

export interface RateLimitEvent {
  type: 'rate_limit';
  status: 'rejected' | 'allowed_warning';
  resetsAt?: string;
  rateLimitType?: string;
  utilization?: number;
}

export interface SessionEvent {
  type: 'session';
  sessionId: string;
}

export interface AttachmentEvent {
  type: 'attachment';
  fileId: string;
  filename: string;
  mimeType: string;
  size: number;
  contentType: 'image' | 'audio' | 'file';
  url: string;
}

/**
 * End the message being streamed and begin a new one, without ending the turn.
 * A lane that speaks in chunks (the heartbeat CLI writes one outbox line per
 * time it comes up for air) uses this so each chunk lands as a real message —
 * bubble, avatar, voice split — while the turn keeps working, instead of the
 * whole reply appearing only once the turn finishes.
 */
export interface MessageBreakEvent {
  type: 'message_break';
}

/**
 * `silent` is a chosen non-reply, not an empty one: the companion answered a
 * wake with the silence sentinel. The runtime filters the sentinel out of the
 * text stream, so this flag is the only thing left telling the router the
 * quiet was deliberate — without it an intentionally quiet turn is
 * indistinguishable from a turn that produced nothing, and gets stamped with
 * a '[No response]' bubble.
 */
export interface DoneEvent {
  type: 'done';
  finishReason: 'complete' | 'aborted' | 'timeout' | 'max_turns' | 'silent';
}

export interface ErrorEvent {
  type: 'error';
  message: string;
  code?: string;
}

// ─── Runtime input ───────────────────────────────────────────────────

export interface RuntimeTurnInput {
  prompt: string;
  model: string;
  /** Explicit provider — skips auto-detection in the API router */
  provider?: string;
  systemPrompt: string;
  cwd: string;
  thinking: 'adaptive' | 'enabled' | 'disabled';
  /** Native provider reasoning effort. Adaptive/null lets the provider choose. */
  effort?: 'adaptive' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';
  /** Provider service tier; currently Codex standard or priority/fast. */
  serviceTier?: 'standard' | 'fast';
  maxTurns: number;
  isAutonomous: boolean;

  /** MCP servers to pass (SDK only — router uses executeTool callback) */
  mcpServers?: Record<string, McpServerConfig>;

  /** Resume an existing session (SDK only) */
  resumeSessionId?: string;

  /** AbortController for cancellation */
  abortController?: AbortController;

  /** Image blocks for multimodal input */
  imageBlocks?: Array<{ type: string; [key: string]: unknown }>;
}

// ─── Runtime capabilities ────────────────────────────────────────────

export interface RuntimeCapabilities {
  /** Supports session resume across turns */
  sessionResume: boolean;
  /** Supports automatic context compaction */
  autoCompaction: boolean;
  /** Supports file checkpointing / rewind */
  fileRewind: boolean;
  /** Supports MCP server management (reconnect, toggle) */
  mcpManagement: boolean;
  /** Supports streaming text deltas */
  streaming: boolean;
  /** Supports extended thinking */
  thinking: boolean;
  /** Supports tool calling */
  toolCalling: boolean;
}

// ─── Runtime interface ───────────────────────────────────────────────

export interface AgentRuntime {
  /** Human-readable name for logging */
  readonly name: string;

  /** What this runtime can and can't do */
  readonly capabilities: RuntimeCapabilities;

  /**
   * Execute a turn and yield normalized events.
   * The consumer iterates over events, building the response as they arrive.
   */
  runTurn(input: RuntimeTurnInput): AsyncIterable<AgentRuntimeEvent>;

  /**
   * Abort the current turn (if running).
   * Returns true if there was something to abort.
   */
  abort(): boolean;

  /**
   * Get the session ID from the most recent turn (SDK only).
   * Returns null for stateless runtimes.
   */
  getSessionId(): string | null;

  /**
   * SDK-specific: get the underlying Query object for MCP operations.
   * Returns null for non-SDK runtimes.
   */
  getActiveQuery(): unknown | null;

  /**
   * Release per-turn resources once the consumer has finished reading events.
   * Session-capable runtimes may keep their provider-side session while closing
   * local sockets/subscriptions that must not survive into the next turn.
   */
  dispose?(): void | Promise<void>;
}
