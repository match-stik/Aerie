// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * API Router runtime — wraps the multi-provider router (router.ts)
 * behind the AgentRuntime interface.
 *
 * Supports: Ollama, OpenRouter, Anthropic direct API, Groq, xAI, OpenAI, HuggingFace.
 * No session resume, no auto-compaction, no MCP management.
 * Tool calling works via the inferenceWithTools() loop.
 *
 * For this runtime, conversation history must be loaded from the DB
 * and passed as context (the router has no memory between calls).
 */

import {
  streamInference,
  inferenceWithTools,
  loadProviderConfig,
  type RouterMessage,
  type ToolSchema,
  type ProviderConfig,
  type ProviderUsage,
} from '../router.js';
import type {
  AgentRuntime,
  AgentRuntimeEvent,
  RuntimeTurnInput,
  RuntimeCapabilities,
} from './types.js';
import type { ImageBlock } from '../visual-blocks.js';

// ─── Image block conversion ──────────────────────────────────────────

/**
 * Convert Anthropic-format ImageBlocks to OpenAI-compatible content parts.
 * OpenAI vision expects: { type: 'image_url', image_url: { url: 'data:mime;base64,...' } }
 * Anthropic sends:       { type: 'image', source: { type: 'base64', media_type, data } }
 */
function imageBlocksToOpenAIParts(blocks: ImageBlock[]): Array<{ type: 'image_url'; image_url: { url: string } }> {
  return blocks.map(b => ({
    type: 'image_url' as const,
    image_url: {
      url: `data:${b.source.media_type};base64,${b.source.data}`,
    },
  }));
}

// ─── Provider detection from model string ────────────────────────────

/**
 * Determine the provider from the model identifier.
 * Format: "provider/model-name" or bare model name.
 * Bare names use a heuristic based on known model prefixes.
 */
function detectProvider(model: string, config: ProviderConfig): { provider: string; modelId: string } {
  // Explicit provider prefix: "ollama/llama3.1", "openrouter/meta-llama/..."
  if (model.includes('/')) {
    const slashIdx = model.indexOf('/');
    const prefix = model.slice(0, slashIdx).toLowerCase();
    const knownProviders = ['ollama', 'openrouter', 'anthropic', 'groq', 'xai', 'openai', 'huggingface'];
    if (knownProviders.includes(prefix)) {
      return { provider: prefix, modelId: model.slice(slashIdx + 1) };
    }
    // Could be openrouter format "org/model"
    if (config.openrouter?.api_key) {
      return { provider: 'openrouter', modelId: model };
    }
  }

  // Ollama model shape: "name:tag" (colon, no slash) — e.g. gpt-oss:120b, gemma3:27b, kimi-k2:1t
  // This MUST come before other heuristics because Ollama models can have any prefix
  if (model.includes(':') && !model.includes('/') && config.ollama?.base_url) {
    return { provider: 'ollama', modelId: model };
  }

  // Heuristic detection from model name
  const lower = model.toLowerCase();
  if (lower.startsWith('claude-') || lower.startsWith('anthropic/')) {
    return { provider: 'anthropic', modelId: model };
  }
  if (lower.startsWith('gpt-') || lower.startsWith('o1') || lower.startsWith('o3')) {
    return { provider: 'openai', modelId: model };
  }
  if (lower.includes('llama') || lower.includes('mistral') || lower.includes('qwen') || lower.includes('gemma') || lower.includes('phi')) {
    // Local models — prefer Ollama if configured, fallback to OpenRouter
    if (config.ollama?.base_url) return { provider: 'ollama', modelId: model };
    if (config.openrouter?.api_key) return { provider: 'openrouter', modelId: model };
  }
  if (lower.startsWith('mixtral') || lower.includes('groq')) {
    if (config.groq?.api_key) return { provider: 'groq', modelId: model };
  }
  if (lower.startsWith('grok')) {
    if (config.xai?.api_key) return { provider: 'xai', modelId: model };
  }

  // Fallback: OpenRouter if available, then Ollama
  if (config.openrouter?.api_key) return { provider: 'openrouter', modelId: model };
  if (config.ollama?.base_url) return { provider: 'ollama', modelId: model };

  return { provider: 'openrouter', modelId: model };
}

// ─── Conversation history loader ─────────────────────────────────────

export interface ConversationMessage {
  role: 'user' | 'companion';
  content: string;
  createdAt: string;
  /**
   * Display name of the companion who actually wrote this message. A shared
   * thread's history holds every voice, so a recycle seed that labels all of
   * them with the reading lane's own name teaches a fresh session it speaks
   * for the whole room. Carry the real author instead.
   */
  authorName?: string | null;
}

/**
 * Callback to load conversation history from the database.
 * The agent.ts provides this — returns recent messages for context.
 */
export type HistoryLoader = (threadId: string, limit: number) => ConversationMessage[];

/**
 * Callback to execute a tool by name.
 * Aerie provides this — routes to MCP servers or native tools.
 */
export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<{ result: string; ok: boolean }>;

// ─── Router Runtime ──────────────────────────────────────────────────

export interface ApiRouterOptions {
  /** Load conversation history for context */
  loadHistory?: HistoryLoader;
  /** Execute tools when the model requests them */
  executeTool?: ToolExecutor;
  /** Available tools to offer the model */
  tools?: ToolSchema[];
  /** Max history messages to include (default: 50) */
  historyLimit?: number;
  /** Thread ID for history loading */
  threadId?: string;
}

export class ApiRouterRuntime implements AgentRuntime {
  readonly name = 'api-router';

  readonly capabilities: RuntimeCapabilities = {
    sessionResume: false,
    autoCompaction: false,
    fileRewind: false,
    mcpManagement: false,
    streaming: true,
    thinking: true, // Injected via prompt for non-Anthropic, native for Anthropic
    toolCalling: true,
  };

  private abortController: AbortController | null = null;
  private aborted = false;
  private options: ApiRouterOptions;

  constructor(options: ApiRouterOptions = {}) {
    this.options = options;
  }

  abort(): boolean {
    if (this.abortController) {
      this.aborted = true;
      this.abortController.abort();
      return true;
    }
    return false;
  }

  getSessionId(): string | null {
    return null; // Stateless
  }

  getActiveQuery(): null {
    return null; // No SDK query object
  }

  async *runTurn(input: RuntimeTurnInput): AsyncIterable<AgentRuntimeEvent> {
    const { prompt, model, systemPrompt, thinking } = input;
    this.abortController = input.abortController || new AbortController();
    this.aborted = false;

    const config = await loadProviderConfig();
    const explicitProvider = input.provider;
    const { provider, modelId } = explicitProvider
      ? { provider: explicitProvider, modelId: model }
      : detectProvider(model, config);
    const useThinking = thinking === 'enabled' || thinking === 'adaptive';

    // Build message array: system + history + current user message
    const messages: RouterMessage[] = [];

    // System prompt
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    // Load conversation history if available
    if (this.options.loadHistory && this.options.threadId) {
      const limit = this.options.historyLimit || 50;
      const history = this.options.loadHistory(this.options.threadId, limit);
      for (const msg of history) {
        messages.push({
          role: msg.role === 'companion' ? 'assistant' : 'user',
          content: msg.content,
        });
      }
      // The current user message is already saved to DB before the agent runs,
      // so it appears at the end of history. Drop it to avoid duplication —
      // we append the enriched version (with orientation context) below.
      const last = messages[messages.length - 1];
      if (last && last.role === 'user') {
        messages.pop();
      }
    }

    // Current user message (with orientation context already prepended)
    // If images are present, build multipart content array for vision
    const imageBlocks = input.imageBlocks as ImageBlock[] | undefined;
    if (imageBlocks && imageBlocks.length > 0) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          ...imageBlocksToOpenAIParts(imageBlocks),
        ],
      });
    } else {
      messages.push({ role: 'user', content: prompt });
    }

    const tools = this.options.tools || [];
    const executeTool = this.options.executeTool;

    try {
      // If we have tools and an executor, use the tool-calling loop (non-streaming)
      if (tools.length > 0 && executeTool) {
        let content = '';
        let realUsage: ProviderUsage | null = null;

        for await (const ev of inferenceWithTools(
          messages,
          modelId,
          provider,
          config,
          tools,
          async (name, args) => executeTool(name, args),
          useThinking,
        )) {
          if (ev.type === 'usage') {
            realUsage = {
              inputTokens: ev.inputTokens,
              outputTokens: ev.outputTokens,
              cacheReadTokens: ev.cacheReadTokens,
              cacheWriteTokens: ev.cacheWriteTokens,
            };
          } else if (ev.type === 'tool_start') {
            yield {
              type: 'tool_start',
              toolUseId: ev.id,
              toolName: ev.name,
              input: (ev.input ?? {}) as Record<string, unknown>,
            };
          } else if (ev.type === 'tool_result') {
            yield {
              type: 'tool_result',
              toolUseId: ev.id,
              toolName: ev.name,
              output: ev.output,
              isError: ev.isError,
            };
          } else if (ev.type === 'done') {
            content = ev.content;
          }
        }

        // Parse thinking from response if present
        const thinkMatch = content.match(/^<think>([\s\S]*?)<\/think>\s*([\s\S]*)$/);
        if (thinkMatch) {
          const thinkingText = thinkMatch[1];
          const responseText = thinkMatch[2];
          yield { type: 'thinking_delta', text: thinkingText };
          yield { type: 'thinking_end', fullText: thinkingText };
          if (responseText) {
            yield { type: 'text_delta', text: responseText };
          }
        } else {
          yield { type: 'text_delta', text: content };
        }

        // Prefer real provider usage (Anthropic reports it, with cache split);
        // fall back to the ~4 chars/token estimate for providers that don't.
        if (realUsage) {
          yield {
            type: 'usage',
            model: modelId,
            inputTokens: realUsage.inputTokens,
            outputTokens: realUsage.outputTokens,
            cacheReadTokens: realUsage.cacheReadTokens,
            cacheWriteTokens: realUsage.cacheWriteTokens,
            contextWindow: 0,
          };
        } else {
          const inputChars = messages.reduce((sum, m) => sum + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length), 0);
          yield {
            type: 'usage',
            model: modelId,
            inputTokens: Math.ceil(inputChars / 4),
            outputTokens: Math.ceil(content.length / 4),
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            contextWindow: 0,
          };
        }

        yield { type: 'done', finishReason: 'complete' };
      } else {
        // No tools — use streaming inference
        let fullThinking = '';
        let inThinking = false;
        let thinkBuffer = '';
        let outputChars = 0;
        let realUsage: ProviderUsage | null = null;

        for await (const token of streamInference(messages, modelId, provider, config, useThinking, u => { realUsage = u; })) {
          if (this.aborted) {
            yield { type: 'done', finishReason: 'aborted' };
            return;
          }

          // Detect thinking tags in stream
          thinkBuffer += token;

          // Check for <think> opening
          if (!inThinking && thinkBuffer.includes('<think>')) {
            inThinking = true;
            // Emit anything before <think> as text
            const beforeThink = thinkBuffer.split('<think>')[0];
            if (beforeThink) { outputChars += beforeThink.length; yield { type: 'text_delta', text: beforeThink }; }
            thinkBuffer = thinkBuffer.split('<think>').slice(1).join('<think>');
            continue;
          }

          // Inside thinking — accumulate until </think>
          if (inThinking) {
            if (thinkBuffer.includes('</think>')) {
              const parts = thinkBuffer.split('</think>');
              fullThinking += parts[0];
              yield { type: 'thinking_delta', text: parts[0] };
              yield { type: 'thinking_end', fullText: fullThinking };
              inThinking = false;
              // Emit remainder as text
              const after = parts.slice(1).join('</think>').replace(/^\s*\n?/, '');
              if (after) { outputChars += after.length; yield { type: 'text_delta', text: after }; }
              thinkBuffer = '';
            } else {
              // Still inside thinking — emit delta but keep buffer small
              if (thinkBuffer.length > 100) {
                fullThinking += thinkBuffer;
                yield { type: 'thinking_delta', text: thinkBuffer };
                thinkBuffer = '';
              }
            }
            continue;
          }

          // Regular text — emit and clear buffer
          if (thinkBuffer.length > 0 && !thinkBuffer.includes('<')) {
            outputChars += thinkBuffer.length;
            yield { type: 'text_delta', text: thinkBuffer };
            thinkBuffer = '';
          } else if (thinkBuffer.length > 20 && !thinkBuffer.includes('<think')) {
            // Not a think tag — flush
            outputChars += thinkBuffer.length;
            yield { type: 'text_delta', text: thinkBuffer };
            thinkBuffer = '';
          }
        }

        // Flush remaining buffer
        if (thinkBuffer) {
          if (inThinking) {
            fullThinking += thinkBuffer;
            yield { type: 'thinking_delta', text: thinkBuffer };
            yield { type: 'thinking_end', fullText: fullThinking };
          } else {
            outputChars += thinkBuffer.length;
            yield { type: 'text_delta', text: thinkBuffer };
          }
        }

        // Prefer real provider usage; fall back to the chars/4 estimate
        if (realUsage) {
          const u: ProviderUsage = realUsage;
          yield {
            type: 'usage',
            model: modelId,
            inputTokens: u.inputTokens,
            outputTokens: u.outputTokens,
            cacheReadTokens: u.cacheReadTokens,
            cacheWriteTokens: u.cacheWriteTokens,
            contextWindow: 0,
          };
        } else {
          const inputChars = messages.reduce((sum, m) => sum + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length), 0);
          yield {
            type: 'usage',
            model: modelId,
            inputTokens: Math.ceil(inputChars / 4),
            outputTokens: Math.ceil(outputChars / 4),
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            contextWindow: 0,
          };
        }

        yield { type: 'done', finishReason: 'complete' };
      }
    } catch (err) {
      if (this.aborted) {
        yield { type: 'done', finishReason: 'aborted' };
      } else {
        yield { type: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    } finally {
      this.abortController = null;
    }
  }
}
