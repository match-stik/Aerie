// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * Claude SDK runtime — wraps @anthropic-ai/claude-agent-sdk query()
 * behind the AgentRuntime interface.
 *
 * This is the "full power" runtime: session resume, auto-compaction,
 * file rewind, MCP server management, extended thinking, streaming.
 * Everything Aerie already does — just behind a clean interface.
 */

import { query, AbortError, type Options, type Query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ImageBlockParam } from '@anthropic-ai/sdk/resources/messages';
import type {
  AgentRuntime,
  AgentRuntimeEvent,
  RuntimeTurnInput,
  RuntimeCapabilities,
} from './types.js';

export class ClaudeSDKRuntime implements AgentRuntime {
  readonly name = 'claude-sdk';

  readonly capabilities: RuntimeCapabilities = {
    sessionResume: true,
    autoCompaction: true,
    fileRewind: true,
    mcpManagement: true,
    streaming: true,
    thinking: true,
    toolCalling: true,
  };

  private activeQuery: Query | null = null;
  private abortController: AbortController | null = null;
  private sessionId: string | null = null;

  abort(): boolean {
    if (this.abortController) {
      this.abortController.abort();
      return true;
    }
    return false;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  getActiveQuery(): Query | null {
    return this.activeQuery;
  }

  async *runTurn(input: RuntimeTurnInput): AsyncIterable<AgentRuntimeEvent> {
    const {
      prompt,
      model,
      systemPrompt,
      cwd,
      thinking,
      effort,
      maxTurns,
      mcpServers,
      resumeSessionId,
      abortController,
      imageBlocks,
    } = input;

    this.abortController = abortController || new AbortController();

    const options: Options = {
      model,
      systemPrompt: systemPrompt
        ? { type: 'preset', preset: 'claude_code', append: systemPrompt }
        : { type: 'preset', preset: 'claude_code' },
      cwd,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      maxTurns,
      includePartialMessages: true,
      // display defaults to 'omitted' on newer models (fable-5+) — signature-only blocks, no text
      thinking: thinking === 'disabled'
        ? { type: 'disabled' }
        : { type: thinking || 'adaptive', display: 'summarized' },
      ...((effort && effort !== 'adaptive') && { effort: effort as Options['effort'] }),
      mcpServers: mcpServers || {},
      abortController: this.abortController,
      enableFileCheckpointing: true,
    };

    if (resumeSessionId) {
      options.resume = resumeSessionId;
    }

    // Build prompt — multimodal or plain text
    let promptInput: string | AsyncIterable<SDKUserMessage>;
    if (imageBlocks && imageBlocks.length > 0) {
      const contentBlocks: Array<{ type: 'text'; text: string } | ImageBlockParam> = [
        { type: 'text', text: prompt },
        ...(imageBlocks as unknown as ImageBlockParam[]),
      ];
      const userMessage: SDKUserMessage = {
        type: 'user',
        message: { role: 'user', content: contentBlocks },
        parent_tool_use_id: null,
      };
      promptInput = (async function* () { yield userMessage; })();
    } else {
      promptInput = prompt;
    }

    const result = query({ prompt: promptInput, options });
    this.activeQuery = result;

    let currentThinking = '';

    try {
      for await (const msg of result) {
        // Capture session ID
        if (msg && typeof msg === 'object' && 'session_id' in msg) {
          const newSessionId = (msg as any).session_id as string;
          if (newSessionId && newSessionId !== this.sessionId) {
            this.sessionId = newSessionId;
            yield { type: 'session', sessionId: newSessionId };
          }
        }

        if (!msg || typeof msg !== 'object' || !('type' in msg)) continue;
        const msgType = (msg as any).type;

        // Thinking from raw stream events
        if (msgType === 'stream_event') {
          const streamEvent = (msg as any).event;
          if (streamEvent?.type === 'content_block_start' && streamEvent?.content_block?.type === 'thinking') {
            currentThinking = '';
          } else if (streamEvent?.type === 'content_block_delta' && streamEvent?.delta?.type === 'thinking_delta') {
            const text = streamEvent.delta.thinking || '';
            if (text) {
              currentThinking += text;
              yield { type: 'thinking_delta', text };
            }
          } else if (streamEvent?.type === 'content_block_stop' && currentThinking) {
            yield { type: 'thinking_end', fullText: currentThinking };
            currentThinking = '';
          }
        }

        // Text content from assistant messages
        if (msgType === 'assistant') {
          const assistantMsg = msg as any;
          if (assistantMsg.message?.content) {
            for (const block of assistantMsg.message.content) {
              if (block.type === 'text' && block.text) {
                yield { type: 'text_delta', text: block.text };
              }
            }
          }
        }

        // Result — usage data
        if (msgType === 'result') {
          const resultMsg = msg as any;
          if (resultMsg.usage || resultMsg.model_usage) {
            const modelUsage = resultMsg.model_usage;
            if (modelUsage) {
              for (const [modelName, modelData] of Object.entries(modelUsage) as [string, any][]) {
                const inp = modelData?.input_tokens ?? modelData?.InputTokens ?? 0;
                const out = modelData?.output_tokens ?? modelData?.OutputTokens ?? 0;
                const cacheRead = modelData?.cache_read_input_tokens ?? modelData?.CacheReadInputTokens ?? 0;
                const cacheWrite = modelData?.cache_creation_input_tokens ?? modelData?.CacheCreationInputTokens ?? 0;
                const ctxWindow = modelData?.context_window ?? 0;

                if (inp > 0) {
                  yield {
                    type: 'usage',
                    model: modelName,
                    inputTokens: inp,
                    outputTokens: out,
                    cacheReadTokens: cacheRead,
                    cacheWriteTokens: cacheWrite,
                    contextWindow: ctxWindow,
                  };
                }
              }
            } else {
              const usage = resultMsg.usage || {};
              const inp = usage.input_tokens ?? usage.InputTokens ?? 0;
              const out = usage.output_tokens ?? usage.OutputTokens ?? 0;
              if (inp > 0) {
                yield {
                  type: 'usage',
                  model,
                  inputTokens: inp,
                  outputTokens: out,
                  cacheReadTokens: usage.cache_read_input_tokens ?? usage.CacheReadInputTokens ?? 0,
                  cacheWriteTokens: usage.cache_creation_input_tokens ?? usage.CacheCreationInputTokens ?? 0,
                  contextWindow: 0,
                };
              }
            }
          }

          if (resultMsg.subtype === 'success') {
            yield { type: 'done', finishReason: 'complete' };
          } else {
            yield { type: 'error', message: `Agent error: ${resultMsg.subtype}`, code: resultMsg.subtype };
          }
        }

        // System messages — compaction
        if (msgType === 'system') {
          const systemMsg = msg as any;
          if (systemMsg.subtype === 'compact_boundary' && systemMsg.compact_metadata) {
            yield { type: 'compaction', preTokens: systemMsg.compact_metadata.pre_tokens || 0 };
          }
        }

        // Rate limits
        if (msgType === 'rate_limit_event') {
          const info = (msg as any).rate_limit_info;
          if (info && (info.status === 'rejected' || info.status === 'allowed_warning')) {
            yield {
              type: 'rate_limit',
              status: info.status,
              resetsAt: info.resetsAt,
              rateLimitType: info.rateLimitType,
              utilization: info.utilization,
            };
          }
        }

        // Tool progress
        if (msgType === 'tool_progress') {
          const tp = msg as any;
          yield {
            type: 'tool_progress',
            toolUseId: tp.tool_use_id,
            toolName: tp.tool_name,
            elapsed: tp.elapsed_time_seconds,
          };
        }
      }
    } catch (err) {
      if (err instanceof AbortError || (err instanceof Error && err.name === 'AbortError')) {
        yield { type: 'done', finishReason: 'aborted' };
      } else {
        yield { type: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    } finally {
      this.abortController = null;
      // Don't null activeQuery here — agent.ts may still need it for MCP status
    }
  }

  /** Clean up — call when the turn is fully processed */
  cleanup(): void {
    this.activeQuery = null;
    this.abortController = null;
  }
}
