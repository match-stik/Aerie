// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Portions derive from Covenant (Maggie) — the Codex Responses-API runtime — see NOTICE.
/**
 * CodexRuntime — OpenAI Codex (ChatGPT OAuth) runtime using pi-ai's
 * Responses API streaming. Ported from Covenant's implementation,
 * adapted for Aerie's AgentRuntime interface.
 *
 * Uses pi-ai's openai-codex-responses stream which hits the Responses API
 * (/v1/responses), NOT the Chat Completions API. The ChatGPT consumer
 * OAuth token only works with Responses API — Chat Completions requires
 * platform API credits.
 *
 * Stateless by design: pi-ai sends `store: false` and the full message
 * array on every request. No session chaining via `previous_response_id`.
 */

import { stream as streamOpenAICodexResponses } from '@earendil-works/pi-ai/api/openai-codex-responses';
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex';
import { type Message as PiMessage, type AssistantMessageEvent, type Model } from '@earendil-works/pi-ai';
import {
  getCodexAccessToken,
  CodexAuthRequiredError,
} from '../auth/codex-oauth.js';
import type {
  AgentRuntime,
  AgentRuntimeEvent,
  RuntimeTurnInput,
  RuntimeCapabilities,
} from './types.js';
import type { ConversationMessage, HistoryLoader, ToolExecutor } from './api-router.js';
import type { ToolSchema } from '../router.js';
import type { ImageBlock } from '../visual-blocks.js';

// ─── Options ──────────────────────────────────────────────────────────

export interface CodexRuntimeOptions {
  loadHistory?: HistoryLoader;
  threadId?: string;
  historyLimit?: number;
  tools?: ToolSchema[];
  executeTool?: ToolExecutor;
}

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Map thinking effort strings to pi-ai's reasoningEffort enum.
 * Non-reasoning models silently ignore it.
 */
function mapEffort(
  thinking: string,
  effort?: string,
): 'low' | 'medium' | 'high' | 'xhigh' | undefined {
  if (effort === 'low' || effort === 'medium' || effort === 'high' || effort === 'xhigh') return effort;
  if (effort === 'max' || effort === 'ultra') return 'xhigh'; // pi-ai lane's enum stops at xhigh
  if (thinking === 'enabled') return 'high';
  return undefined;
}

/**
 * Resolve a model id to pi-ai's Model<'openai-codex-responses'> object.
 * Throws if the id isn't in pi-ai's registry.
 */
function resolveCodexModel(modelId: string): Model<'openai-codex-responses'> {
  const model = openaiCodexProvider().getModels().find((m) => m.id === modelId);
  if (!model) {
    throw new Error(
      `Model "${modelId}" is not registered in pi-ai's openai-codex provider. ` +
      `Check that the model ID matches pi-ai's registry.`,
    );
  }
  return model;
}

/**
 * Convert Anthropic-format ImageBlocks to pi-ai ImageContent objects.
 * Anthropic: { type: 'image', source: { type: 'base64', media_type, data } }
 * pi-ai:     { type: 'image', data: string, mimeType: string }
 */
function imageBlocksToPiContent(blocks: ImageBlock[]): Array<{ type: 'image'; data: string; mimeType: string }> {
  return blocks.map(b => ({
    type: 'image' as const,
    data: b.source.data,
    mimeType: b.source.media_type,
  }));
}

/**
 * Convert DB history messages to pi-ai's Message format.
 * System messages are handled separately via systemPrompt.
 */
function toPiMessages(messages: ConversationMessage[]): PiMessage[] {
  const out: PiMessage[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({
        role: 'user',
        content: m.content,
        timestamp: Date.parse(m.createdAt) || Date.now(),
      });
    } else if (m.role === 'companion') {
      out.push({
        role: 'assistant',
        content: [{ type: 'text', text: m.content }],
        api: 'openai-codex-responses',
        provider: 'openai-codex',
        model: 'replayed',
        usage: {
          input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: Date.parse(m.createdAt) || Date.now(),
      });
    }
  }
  return out;
}

/**
 * Extract inline base64 image data from a tool result string and return
 * proper pi-ai content blocks (text + image). This lets the Responses API
 * handle images natively instead of choking on megabytes of base64 text.
 *
 * Strategy: try JSON.parse first (most tool results are JSON). If the
 * result is a JSON string containing image blocks, extract them properly.
 * Falls back to regex for data-URI patterns in plain text.
 */
type ToolResultContentBlock = {
  type: 'text'; text: string;
} | {
  type: 'image'; data: string; mimeType: string;
};

function parseToolResultContent(raw: string): ToolResultContentBlock[] {
  const blocks: ToolResultContentBlock[] = [];

  // ── Try JSON parse first ──────────────────────────────────────
  try {
    const parsed = JSON.parse(raw);

    // If the result is an object with a "type":"image" + "data" field
    if (parsed && parsed.type === 'image' && typeof parsed.data === 'string' && parsed.data.length > 256) {
      return [{
        type: 'image' as const,
        data: parsed.data,
        mimeType: parsed.mimeType || parsed.mime_type || 'image/png',
      }];
    }

    // If it's an array of content blocks (MCP-style)
    if (Array.isArray(parsed)) {
      return extractFromArray(parsed);
    }

    // If it has a nested content array
    if (parsed && Array.isArray(parsed.content)) {
      const extracted = extractFromArray(parsed.content);
      if (extracted.some(b => b.type === 'image')) {
        // Add any top-level text context that isn't in content
        const { content, ...rest } = parsed;
        const meta = Object.keys(rest).length > 0 ? JSON.stringify(rest, null, 2) : '';
        if (meta) blocks.push({ type: 'text' as const, text: meta });
        blocks.push(...extracted);
        return blocks;
      }
    }
  } catch {
    // Not JSON — fall through to regex
  }

  // ── Regex fallback for data URIs in plain text ────────────────
  const dataUriRe = /data:(image\/[^;]+);base64,([A-Za-z0-9+/=]{256,})/g;
  let m: RegExpExecArray | null;
  let cursor = 0;
  let found = false;

  while ((m = dataUriRe.exec(raw)) !== null) {
    found = true;
    const textBefore = raw.slice(cursor, m.index).trim();
    if (textBefore) blocks.push({ type: 'text' as const, text: textBefore });
    blocks.push({ type: 'image' as const, data: m[2], mimeType: m[1] });
    cursor = m.index + m[0].length;
  }

  if (found) {
    const trailing = raw.slice(cursor).trim();
    if (trailing) blocks.push({ type: 'text' as const, text: trailing });
    return blocks;
  }

  // No images found — plain text
  return [{ type: 'text' as const, text: raw }];
}

/** Walk an array of content blocks, pulling out images vs text. */
function extractFromArray(arr: any[]): ToolResultContentBlock[] {
  const out: ToolResultContentBlock[] = [];
  for (const item of arr) {
    if (item.type === 'image' && typeof item.data === 'string' && item.data.length > 256) {
      out.push({
        type: 'image' as const,
        data: item.data,
        mimeType: item.mimeType || item.mime_type || item.source?.media_type || 'image/png',
      });
    } else if (item.type === 'text' && typeof item.text === 'string') {
      out.push({ type: 'text' as const, text: item.text });
    } else {
      // Unknown block — serialize as text
      out.push({ type: 'text' as const, text: JSON.stringify(item) });
    }
  }
  return out;
}

// ─── Runtime ──────────────────────────────────────────────────────────

export class CodexRuntime implements AgentRuntime {
  readonly name = 'codex';

  readonly capabilities: RuntimeCapabilities = {
    sessionResume: false,
    autoCompaction: false,
    fileRewind: false,
    mcpManagement: false,
    streaming: true,
    thinking: true,
    toolCalling: true,
  };

  private abortController: AbortController | null = null;
  private aborted = false;
  private options: CodexRuntimeOptions;

  constructor(options: CodexRuntimeOptions = {}) {
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
    return null;
  }

  getActiveQuery(): null {
    return null;
  }

  async *runTurn(input: RuntimeTurnInput): AsyncIterable<AgentRuntimeEvent> {
    this.abortController = input.abortController || new AbortController();
    this.aborted = false;

    // ── Auth gate ────────────────────────────────────────────────
    let accessToken: string;
    try {
      accessToken = await getCodexAccessToken();
    } catch (err) {
      if (err instanceof CodexAuthRequiredError) {
        yield {
          type: 'error',
          message: 'Codex auth required. Log in via Settings → Codex tab.',
        };
        yield { type: 'done', finishReason: 'complete' };
        return;
      }
      yield {
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
      yield { type: 'done', finishReason: 'complete' };
      return;
    }

    // ── Resolve pi-ai model ─────────────────────────────────────
    let piModel: Model<'openai-codex-responses'>;
    try {
      piModel = resolveCodexModel(input.model);
    } catch (err) {
      yield {
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
      yield { type: 'done', finishReason: 'complete' };
      return;
    }

    // ── Build message array ─────────────────────────────────────
    const piMessages: PiMessage[] = [];

    // Load conversation history
    if (this.options.loadHistory && this.options.threadId) {
      const limit = this.options.historyLimit || 50;
      const history = this.options.loadHistory(this.options.threadId, limit);
      piMessages.push(...toPiMessages(history));
      // Drop the last user message — the enriched prompt replaces it
      const last = piMessages[piMessages.length - 1];
      if (last && last.role === 'user') {
        piMessages.pop();
      }
    }

    // Current user message — multipart if images are present
    const imageBlocks = input.imageBlocks as ImageBlock[] | undefined;
    if (imageBlocks && imageBlocks.length > 0) {
      piMessages.push({
        role: 'user',
        content: [
          { type: 'text' as const, text: input.prompt },
          ...imageBlocksToPiContent(imageBlocks),
        ],
        timestamp: Date.now(),
      });
    } else {
      piMessages.push({
        role: 'user',
        content: input.prompt,
        timestamp: Date.now(),
      });
    }

    // Convert tools to pi-ai format
    const piTools = (this.options.tools && this.options.tools.length > 0)
      ? this.options.tools.map(t => ({
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        }))
      : undefined;

    const reasoningEffort = mapEffort(input.thinking, input.effort);
    const executeTool = this.options.executeTool;
    const MAX_TOOL_ITERATIONS = 15;

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheRead = 0;
    let totalCacheWrite = 0;

    console.log(
      `[CodexRuntime] turn start: model=${input.model}, ` +
      `messages=${piMessages.length}, ` +
      `images=${imageBlocks?.length ?? 0}, ` +
      `tools=${piTools?.length ?? 0}, ` +
      `effort=${reasoningEffort ?? 'default'}`,
    );

    // ── Multi-turn tool loop ────────────────────────────────────
    let thinkingBuffer: string | null = null;
    let outputChars = 0;

    try {
      for (let iteration = 0; iteration <= MAX_TOOL_ITERATIONS; iteration++) {
        const context = {
          systemPrompt: input.systemPrompt,
          messages: piMessages,
          tools: piTools,
        };

        let stream;
        try {
          stream = streamOpenAICodexResponses(piModel, context, {
            apiKey: accessToken,
            signal: this.abortController!.signal,
            reasoningEffort,
            reasoningSummary: 'auto',
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (/401|unauthor/i.test(msg)) {
            yield { type: 'error', message: `Codex auth rejected: ${msg}. Try logging in again via Settings.` };
          } else {
            yield { type: 'error', message: msg };
          }
          yield { type: 'done', finishReason: 'complete' };
          return;
        }

        const pendingToolCalls: Array<{
          id: string; name: string; arguments: Record<string, any>;
          result: string; ok: boolean;
        }> = [];

        for await (const event of stream) {
          if (this.aborted) {
            console.log(`[CodexRuntime] aborted mid-stream`);
            yield { type: 'done', finishReason: 'aborted' };
            return;
          }

          // Log event types for debugging
          if (event.type !== 'text_delta' && event.type !== 'thinking_delta') {
            console.log(`[CodexRuntime] event: ${event.type}`);
          }

          // Thinking buffering
          if (event.type === 'thinking_start') { thinkingBuffer = ''; continue; }
          if (event.type === 'thinking_delta' && thinkingBuffer !== null) {
            thinkingBuffer += event.delta;
            continue;
          }
          if (event.type === 'thinking_end') {
            if (thinkingBuffer && thinkingBuffer.length > 0) {
              yield { type: 'thinking_delta', text: thinkingBuffer };
              yield { type: 'thinking_end', fullText: thinkingBuffer };
            }
            thinkingBuffer = null;
            continue;
          }

          // Text deltas
          if (event.type === 'text_delta') {
            console.log(`[CodexRuntime] text_delta: ${event.delta.length} chars`);
            outputChars += event.delta.length;
            yield { type: 'text_delta', text: event.delta };
            continue;
          }

          // Tool calls — collect args on start/delta, execute on end
          if (event.type === 'toolcall_start' || event.type === 'toolcall_delta') {
            continue;
          }
          if (event.type === 'toolcall_end') {
            const tc = (event as any).toolCall;
            yield {
              type: 'tool_start',
              toolUseId: tc.id,
              toolName: tc.name,
              input: tc.arguments as Record<string, unknown>,
            };
            if (executeTool) {
              const { result, ok } = await executeTool(tc.name, tc.arguments);
              yield {
                type: 'tool_result',
                toolUseId: tc.id,
                toolName: tc.name,
                output: result,
                isError: !ok,
              };
              pendingToolCalls.push({
                id: tc.id, name: tc.name, arguments: tc.arguments,
                result, ok,
              });
            }
            continue;
          }

          // Errors from the stream
          if (event.type === 'error') {
            const errMsg = (event as any).error?.errorMessage ?? `Codex stream error (${(event as any).reason})`;
            if (/401|unauthor/i.test(errMsg)) {
              yield { type: 'error', message: `Codex auth expired: ${errMsg}. Log in again via Settings.` };
            } else if (/429|rate.?limit/i.test(errMsg)) {
              yield { type: 'error', message: `Codex rate limited: ${errMsg}. Try again in a moment.` };
            } else {
              yield { type: 'error', message: errMsg };
            }
            continue;
          }

          // done, start, text_start, text_end — structural, skip
        }

        // Flush remaining thinking buffer
        if (thinkingBuffer && thinkingBuffer.length > 0) {
          yield { type: 'thinking_delta', text: thinkingBuffer };
          yield { type: 'thinking_end', fullText: thinkingBuffer };
          thinkingBuffer = null;
        }

        // Accumulate usage from this iteration
        const iterResult = await stream.result();
        if (iterResult.usage) {
          totalInputTokens += iterResult.usage.input;
          totalOutputTokens += iterResult.usage.output;
          totalCacheRead += iterResult.usage.cacheRead;
          totalCacheWrite += iterResult.usage.cacheWrite;
        }

        // No tool calls this iteration — we're done
        console.log(`[CodexRuntime] iteration ${iteration} done: outputChars=${outputChars}, tools=${pendingToolCalls.length}`);
        if (pendingToolCalls.length === 0) break;

        // Append assistant message + tool results for next iteration
        piMessages.push(iterResult as unknown as PiMessage);
        const toolImages: Array<{ type: 'image'; data: string; mimeType: string }> = [];
        for (const tc of pendingToolCalls) {
          // Parse out inline base64 images from tool results
          const contentBlocks = parseToolResultContent(tc.result);

          // Separate text from images — function_call_output in the
          // Responses API only supports string output, so images in
          // toolResult content get stringified back to JSON text.
          // Instead, collect images and inject them as a user message
          // after all tool results (user messages DO support input_image).
          const textBlocks = contentBlocks.filter(b => b.type === 'text');
          const imageBlocks = contentBlocks.filter(b => b.type === 'image');

          piMessages.push({
            role: 'toolResult',
            toolCallId: tc.id,
            toolName: tc.name,
            content: textBlocks.length > 0
              ? textBlocks
              : [{ type: 'text' as const, text: imageBlocks.length > 0 ? '(image returned — see below)' : '(empty result)' }],
            isError: !tc.ok,
            timestamp: Date.now(),
          } as unknown as PiMessage);

          for (const img of imageBlocks) {
            if (img.type === 'image') toolImages.push(img);
          }
        }

        // If any tool results contained images, inject a user message
        // with the images as proper content blocks. The Responses API
        // handles input_image in user messages natively.
        if (toolImages.length > 0) {
          piMessages.push({
            role: 'user',
            content: [
              { type: 'text' as const, text: '[Tool returned the following image(s):]' },
              ...toolImages,
            ],
            timestamp: Date.now(),
          } as unknown as PiMessage);
        }
      }

      // Emit accumulated usage
      if (totalInputTokens > 0 || totalOutputTokens > 0) {
        yield {
          type: 'usage',
          model: input.model,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          cacheReadTokens: totalCacheRead,
          cacheWriteTokens: totalCacheWrite,
          contextWindow: 0,
        };
      }

      console.log(`[CodexRuntime] turn complete: outputChars=${outputChars}`);
      yield { type: 'done', finishReason: 'complete' };
    } catch (err) {
      console.error(`[CodexRuntime] CAUGHT ERROR:`, err);
      if (this.aborted || this.abortController?.signal.aborted) {
        console.log(`[CodexRuntime] aborted during error handling`);
        yield { type: 'done', finishReason: 'aborted' };
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (/401|unauthor/i.test(msg)) {
        yield {
          type: 'error',
          message: `Codex auth expired during request: ${msg}. Log in again via Settings.`,
        };
      } else if (/429|rate.?limit/i.test(msg)) {
        yield {
          type: 'error',
          message: `Codex rate limited: ${msg}. Try again in a moment.`,
        };
      } else {
        yield { type: 'error', message: msg };
      }
      yield { type: 'done', finishReason: 'complete' };
    } finally {
      this.abortController = null;
    }
  }
}
