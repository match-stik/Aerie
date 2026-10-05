// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * Multi-provider model router for Aerie
 *
 * Ported from Haven's inferenceWithTools() — adapted for Node.js
 * and Aerie's config system (aerie.yaml instead of D1 settings).
 *
 * Supports: Ollama, OpenRouter, Anthropic (direct API), OpenAI-compatible
 * endpoints (Groq, xAI, HuggingFace), and any custom OpenAI-compatible base.
 *
 * Bug notes from Sidney's tracker:
 *   - Anthropic and OpenAI use different tool calling formats — convert between them
 *   - Ollama's OpenAI-compat endpoint may fail; fall back to native /api/chat
 *   - Some models spiral on tool calls — max 5 iterations then nudge for text
 */

import { getAerieConfig } from '../config.js';

// ─── Types ────────────────────────────────────────────────────────

export interface ProviderConfig {
  ollama?: {
    base_url: string;
    api_key?: string;
  };
  openrouter?: {
    api_key: string;
  };
  anthropic?: {
    api_key: string;
    base_url?: string;
  };
  groq?: {
    api_key: string;
    base_url?: string;
  };
  xai?: {
    api_key: string;
    base_url?: string;
  };
  openai?: {
    api_key: string;
    base_url?: string;
  };
  huggingface?: {
    api_key: string;
    base_url?: string;
  };
}

export interface RouterMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: any;
  tool_calls?: any[];
  tool_call_id?: string;
}

export interface ToolSchema {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  server_url?: string;
}

export interface ToolResult {
  id: string;
  name: string;
  input: unknown;
  result: string;
  ok: boolean;
}

export type InferenceEvent =
  | { type: 'tool_start'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; name: string; output: string; isError: boolean }
  | { type: 'usage'; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }
  | { type: 'done'; content: string; toolResults: ToolResult[] };

/** Real token usage reported by the provider (Anthropic path only for now). */
export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

// ─── Format converters ───────────────────────────────────────────

/** Convert tool schemas to OpenAI function-calling format */
function toolsToOpenAI(tools: ToolSchema[]): any[] {
  return tools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

/** Convert OpenAI-format tool schemas to Anthropic format */
function openaiToolsToAnthropic(openaiTools: any[]): any[] {
  return openaiTools.map(t => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
}

/**
 * Convert a mixed message array (with OpenAI-style tool results) to
 * Anthropic's Messages API format. Extracts system messages, converts
 * tool_calls to tool_use blocks, tool results to tool_result blocks.
 */
function buildAnthropicMessages(
  messages: RouterMessage[],
): { system: string; messages: Array<{ role: string; content: any }> } {
  let system = '';
  const filtered: Array<{ role: string; content: any }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      system += (system ? '\n\n' : '') + text;
    } else if (msg.role === 'tool') {
      const toolResult = {
        type: 'tool_result' as const,
        tool_use_id: msg.tool_call_id,
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      };
      const lastMsg = filtered[filtered.length - 1];
      if (lastMsg?.role === 'user' && Array.isArray(lastMsg.content)) {
        lastMsg.content.push(toolResult);
      } else {
        filtered.push({ role: 'user', content: [toolResult] });
      }
    } else if (msg.role === 'assistant' && msg.tool_calls) {
      const content: any[] = [];
      if (msg.content) content.push({ type: 'text', text: msg.content });
      for (const tc of msg.tool_calls) {
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments || '{}'),
        });
      }
      filtered.push({ role: 'assistant', content });
    } else {
      filtered.push({ role: msg.role, content: msg.content });
    }
  }

  return { system, messages: filtered };
}

// ─── Anthropic request body ──────────────────────────────────────

/**
 * 1-hour prompt cache TTL. Writes cost 2× base input (vs 1.25× for the
 * default 5-minute TTL) but reads cost ~0.1×, and companion conversations
 * have gaps measured in tens of minutes — the hour keeps the cache warm
 * between replies instead of re-billing the whole history every turn.
 */
const CACHE_1H = { type: 'ephemeral', ttl: '1h' } as const;

/**
 * Claude 4.7+ era models (Fable 5, Opus 4.7/4.8) reject temperature/top_p/
 * top_k and thinking budget_tokens with a 400. Fable 5 also rejects an
 * explicit thinking: {type: 'disabled'} — omit the field entirely.
 */
function isStrictClaude(model: string): boolean {
  const m = model.toLowerCase();
  return m.includes('fable') || /opus-4-[789]/.test(m);
}

/** Models with adaptive thinking (Fable 5, Opus 4.6+, Sonnet 4.6+). */
function supportsAdaptiveThinking(model: string): boolean {
  const m = model.toLowerCase();
  return m.includes('fable') || /opus-4-[6789]/.test(m) || /sonnet-4-[6789]/.test(m);
}

/** Models that expose the 1M context window via the context-1m beta header. */
function supports1mContext(model: string): boolean {
  const m = model.toLowerCase();
  return m.includes('fable') || /opus-4-[6789]/.test(m) || /sonnet-4-[5-9]/.test(m);
}

/**
 * Build a Messages API request body with prompt caching and model-aware
 * thinking/sampling params. Cache breakpoints: one on the system block
 * (also covers tools, which render before system) and one on the last
 * message, so each turn re-reads the conversation prefix at cache-read
 * rates instead of full input price.
 *
 * Never mutates the caller's messages — cache markers go on copies,
 * otherwise the tool loop would accumulate stale breakpoints across
 * iterations (max 4 per request, then the API rejects).
 */
function buildAnthropicBody(
  messages: RouterMessage[],
  model: string,
  opts: { stream: boolean; thinking: boolean },
): any {
  const { system, messages: anthropicMsgs } = buildAnthropicMessages(messages);

  const msgs = anthropicMsgs.map(m => ({ ...m }));
  const last = msgs[msgs.length - 1];
  if (last) {
    if (typeof last.content === 'string') {
      last.content = [{ type: 'text', text: last.content, cache_control: CACHE_1H }];
    } else if (Array.isArray(last.content) && last.content.length > 0) {
      const blocks = last.content.map((b: any) => ({ ...b }));
      blocks[blocks.length - 1].cache_control = CACHE_1H;
      last.content = blocks;
    }
  }

  const body: any = {
    model,
    messages: msgs,
    max_tokens: opts.thinking ? 16000 : 4096,
    stream: opts.stream,
  };

  if (opts.thinking) {
    body.thinking = supportsAdaptiveThinking(model)
      ? { type: 'adaptive' }
      : { type: 'enabled', budget_tokens: 10000 };
  } else if (!isStrictClaude(model)) {
    body.temperature = 0.8;
  }

  if (system) {
    body.system = [{ type: 'text', text: system, cache_control: CACHE_1H }];
  }

  return body;
}

// ─── Provider routing ────────────────────────────────────────────

interface ProviderRoute {
  url: string;
  headers: Record<string, string>;
  isAnthropic: boolean;
}

/** Determine endpoint URL and headers for a given provider + model */
export async function resolveProvider(provider: string, model: string, config: ProviderConfig): Promise<ProviderRoute> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  let isAnthropic = false;

  if (provider === 'ollama' && config.ollama) {
    const url = `${config.ollama.base_url}/v1/chat/completions`;
    if (config.ollama.api_key) headers['Authorization'] = `Bearer ${config.ollama.api_key}`;
    return { url, headers, isAnthropic };
  }

  if (provider === 'anthropic') {
    isAnthropic = true;
    const base = config.anthropic?.base_url || 'https://api.anthropic.com/v1';
    headers['x-api-key'] = config.anthropic?.api_key || '';
    headers['anthropic-version'] = '2023-06-01';
    if (supports1mContext(model)) {
      headers['anthropic-beta'] = 'context-1m-2025-08-07';
    }
    return { url: `${base}/messages`, headers, isAnthropic };
  }

  // Codex models now use CodexRuntime (pi-ai Responses API) — see runtimes/codex.ts.
  // If a codex request somehow lands here, surface a clear error.
  if (provider === 'codex') {
    throw new Error(
      'Codex models must be routed through CodexRuntime, not the generic API router. ' +
      'This is a routing bug — the model should have been intercepted in createRuntime().',
    );
  }

  // OpenAI-compatible providers with custom base URLs
  const customProviders: Record<string, { base_url?: string; api_key?: string } | undefined> = {
    openai: config.openai,
    groq: config.groq,
    xai: config.xai,
    huggingface: config.huggingface,
  };

  if (customProviders[provider]) {
    const p = customProviders[provider]!;
    const defaultBases: Record<string, string> = {
      openai: 'https://api.openai.com/v1',
      groq: 'https://api.groq.com/openai/v1',
      xai: 'https://api.x.ai/v1',
      huggingface: 'https://router.huggingface.co/v1',
    };
    const base = p.base_url || defaultBases[provider] || 'https://api.openai.com/v1';
    headers['Authorization'] = `Bearer ${p.api_key}`;
    return { url: `${base}/chat/completions`, headers, isAnthropic };
  }

  // Fallback: OpenRouter
  const orKey = config.openrouter?.api_key || '';
  headers['Authorization'] = `Bearer ${orKey}`;
  headers['X-Title'] = 'Aerie';
  return { url: 'https://openrouter.ai/api/v1/chat/completions', headers, isAnthropic };
}

// ─── Streaming inference ─────────────────────────────────────────

/**
 * Stream tokens from any supported provider.
 * Returns an async generator of string tokens.
 */
export async function* streamInference(
  messages: RouterMessage[],
  model: string,
  provider: string,
  config: ProviderConfig,
  thinking = false,
  onUsage?: (usage: ProviderUsage) => void,
): AsyncGenerator<string> {
  const route = await resolveProvider(provider, model, config);
  const { url, headers, isAnthropic } = route;

  let response: Response;

  if (isAnthropic) {
    const body = buildAnthropicBody(messages, model, { stream: true, thinking });
    response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  } else {
    const inferMsgs = [...messages];
    // Inject chain-of-thought prompt for non-Anthropic models when thinking is requested
    if (thinking && inferMsgs.length > 0 && inferMsgs[0].role === 'system') {
      inferMsgs[0] = {
        ...inferMsgs[0],
        content: inferMsgs[0].content +
          '\n\nThink through your reasoning step by step inside <think> tags before giving your response.',
      };
    }
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, messages: inferMsgs, stream: true, temperature: 0.8 }),
    });
  }

  // Ollama fallback: if OpenAI-compat fails, try native /api/chat
  let useNativeOllama = false;
  if (!response.ok && provider === 'ollama' && config.ollama) {
    const nativeUrl = `${config.ollama.base_url}/api/chat`;
    response = await fetch(nativeUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, messages, stream: true }),
    });
    if (response.ok) useNativeOllama = true;
  }

  if (!response.ok || !response.body) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`Inference failed (${provider}/${model}): ${response.status} — ${errBody.slice(0, 300)}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let anthropicInThinking = false;
  // Real usage off the SSE stream: message_start carries input + cache
  // counts, message_delta carries the final output count.
  const usage: ProviderUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (useNativeOllama) {
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.done) return;
          const token = parsed.message?.content;
          if (token) yield token;
        } catch {}
      } else if (isAnthropic) {
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6).trim();
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'content_block_start' && parsed.content_block?.type === 'thinking') {
            anthropicInThinking = true;
            yield '<think>';
          } else if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'thinking_delta') {
            yield parsed.delta.thinking;
          } else if (parsed.type === 'content_block_stop' && anthropicInThinking) {
            anthropicInThinking = false;
            yield '</think>\n';
          } else if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
            yield parsed.delta.text;
          } else if (parsed.type === 'message_start' && parsed.message?.usage) {
            const u = parsed.message.usage;
            usage.inputTokens = u.input_tokens ?? 0;
            usage.cacheReadTokens = u.cache_read_input_tokens ?? 0;
            usage.cacheWriteTokens = u.cache_creation_input_tokens ?? 0;
          } else if (parsed.type === 'message_delta' && parsed.usage?.output_tokens != null) {
            usage.outputTokens = parsed.usage.output_tokens;
          } else if (parsed.type === 'message_stop') {
            if (onUsage && (usage.inputTokens > 0 || usage.cacheReadTokens > 0 || usage.cacheWriteTokens > 0)) {
              onUsage(usage);
            }
            return;
          }
        } catch {}
      } else {
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6).trim();
        if (data === '[DONE]') return;
        try {
          const parsed = JSON.parse(data);
          const token = parsed.choices?.[0]?.delta?.content;
          if (token) yield token;
        } catch {}
      }
    }
  }
}

// ─── Inference with tool loop ────────────────────────────────────

/**
 * Run inference with tool calling support.
 * Handles up to MAX_ITERATIONS of tool calls, converting between
 * Anthropic and OpenAI tool formats as needed.
 *
 * @param executeTool - callback to execute a tool by name with args.
 *   Aerie provides this — routes to MCP servers or native tools.
 */
export async function* inferenceWithTools(
  messages: RouterMessage[],
  model: string,
  provider: string,
  config: ProviderConfig,
  tools: ToolSchema[],
  executeTool: (name: string, args: Record<string, unknown>) => Promise<{ result: string; ok: boolean }>,
  thinking = false,
): AsyncGenerator<InferenceEvent, void, void> {
  const route = await resolveProvider(provider, model, config);
  const { url, headers, isAnthropic } = route;
  const openaiTools = toolsToOpenAI(tools);

  const conversation = [...messages];
  const allToolResults: ToolResult[] = [];
  const MAX_ITERATIONS = 5;
  const totalUsage: ProviderUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    let resp: Response;

    if (isAnthropic) {
      const body = buildAnthropicBody(conversation, model, { stream: false, thinking });
      if (openaiTools.length > 0) {
        body.tools = openaiToolsToAnthropic(openaiTools);
        body.tool_choice = { type: 'auto' };
      }
      resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    } else {
      resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: conversation,
          tools: openaiTools.length > 0 ? openaiTools : undefined,
          tool_choice: openaiTools.length > 0 ? 'auto' : undefined,
          temperature: 0.8,
          stream: false,
        }),
      });
    }

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Inference error (${provider}/${model}) ${resp.status}: ${errText.slice(0, 200)}`);
    }

    const data = await resp.json() as any;

    if (isAnthropic) {
      // Accumulate real usage across tool iterations
      if (data.usage) {
        totalUsage.inputTokens += data.usage.input_tokens ?? 0;
        totalUsage.outputTokens += data.usage.output_tokens ?? 0;
        totalUsage.cacheReadTokens += data.usage.cache_read_input_tokens ?? 0;
        totalUsage.cacheWriteTokens += data.usage.cache_creation_input_tokens ?? 0;
      }

      // Anthropic Messages API response
      const thinkingParts = (data.content || [])
        .filter((b: any) => b.type === 'thinking')
        .map((b: any) => b.thinking)
        .join('');
      const textParts = (data.content || [])
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('');
      const toolUses = (data.content || [])
        .filter((b: any) => b.type === 'tool_use');
      const fullText = thinkingParts ? `<think>${thinkingParts}</think>\n${textParts}` : textParts;

      if (toolUses.length === 0) {
        if (fullText.trim()) {
          if (totalUsage.inputTokens > 0 || totalUsage.cacheReadTokens > 0 || totalUsage.cacheWriteTokens > 0) {
            yield { type: 'usage', ...totalUsage };
          }
          yield { type: 'done', content: fullText, toolResults: allToolResults };
          return;
        }
        break;
      }

      // Build assistant message with tool_use blocks
      const assistantContent: any[] = [];
      if (textParts) assistantContent.push({ type: 'text', text: textParts });
      for (const tu of toolUses) {
        assistantContent.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input });
      }
      conversation.push({ role: 'assistant', content: assistantContent } as any);

      // Execute tools and build tool_result blocks
      const toolResultContent: any[] = [];
      for (const tu of toolUses) {
        yield { type: 'tool_start', id: tu.id, name: tu.name, input: tu.input };
        const { result, ok } = await executeTool(tu.name, tu.input);
        allToolResults.push({ id: tu.id, name: tu.name, input: tu.input, result, ok });
        yield { type: 'tool_result', id: tu.id, name: tu.name, output: result, isError: !ok };
        toolResultContent.push({ type: 'tool_result', tool_use_id: tu.id, content: result });
      }
      conversation.push({ role: 'user', content: toolResultContent } as any);

    } else {
      // OpenAI-compatible response
      const choice = data.choices?.[0];
      const message = choice?.message;

      if (!message?.tool_calls?.length) {
        const content = (message?.content || '').trim();
        if (content) {
          yield { type: 'done', content, toolResults: allToolResults };
          return;
        }
        break;
      }

      conversation.push(message);

      for (const tc of message.tool_calls) {
        const fn = tc.function;
        const args = JSON.parse(fn.arguments || '{}');
        yield { type: 'tool_start', id: tc.id, name: fn.name, input: args };
        const { result, ok } = await executeTool(fn.name, args);
        allToolResults.push({ id: tc.id, name: fn.name, input: args, result, ok });
        yield { type: 'tool_result', id: tc.id, name: fn.name, output: result, isError: !ok };
        conversation.push({ role: 'tool', content: result, tool_call_id: tc.id } as any);
      }
    }
  }

  // Max iterations exhausted — nudge for a text response without tools
  try {
    const nudge = 'Please respond to the user now with a direct message. Do not call any more tools.';
    let finalResp: Response;
    if (isAnthropic) {
      const body = buildAnthropicBody(
        [...conversation, { role: 'user', content: nudge }],
        model,
        { stream: false, thinking: false },
      );
      finalResp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    } else {
      finalResp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: [...conversation, { role: 'user', content: nudge }],
          temperature: 0.8,
          stream: false,
        }),
      });
    }
    if (finalResp.ok) {
      const finalData = await finalResp.json() as any;
      let finalContent = '';
      if (isAnthropic) {
        if (finalData.usage) {
          totalUsage.inputTokens += finalData.usage.input_tokens ?? 0;
          totalUsage.outputTokens += finalData.usage.output_tokens ?? 0;
          totalUsage.cacheReadTokens += finalData.usage.cache_read_input_tokens ?? 0;
          totalUsage.cacheWriteTokens += finalData.usage.cache_creation_input_tokens ?? 0;
        }
        finalContent = (finalData.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
      } else {
        finalContent = finalData?.choices?.[0]?.message?.content || '';
      }
      if (finalContent) {
        if (totalUsage.inputTokens > 0 || totalUsage.cacheReadTokens > 0 || totalUsage.cacheWriteTokens > 0) {
          yield { type: 'usage', ...totalUsage };
        }
        yield { type: 'done', content: finalContent, toolResults: allToolResults };
        return;
      }
    }
  } catch { /* fall through */ }

  const names = allToolResults.map(r => r.name).join(', ');
  if (totalUsage.inputTokens > 0 || totalUsage.cacheReadTokens > 0 || totalUsage.cacheWriteTokens > 0) {
    yield { type: 'usage', ...totalUsage };
  }
  yield {
    type: 'done',
    content: allToolResults.length > 0
      ? `[Used tools: ${names} — but couldn't produce a final response]`
      : '[No response from model]',
    toolResults: allToolResults,
  };
}

// ─── Simple text completion ──────────────────────────────────────

/**
 * Simple non-streaming text completion. No tools, no thinking.
 * Used for cheap utility tasks like prompt enhancement.
 */
export async function textCompletion(
  systemPrompt: string,
  userPrompt: string,
  model: string,
  provider: string,
  config: ProviderConfig,
): Promise<string> {
  const route = await resolveProvider(provider, model, config);
  const { url, headers } = route;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: 1024, stream: false }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`textCompletion failed (${provider}/${model}): ${response.status} — ${errText.slice(0, 200)}`);
  }

  const data = await response.json() as any;
  return data.choices?.[0]?.message?.content?.trim() || '';
}

// ─── Config loader ───────────────────────────────────────────────

/** Read provider config — BYOK secrets take precedence over aerie.yaml */
export async function loadProviderConfig(): Promise<ProviderConfig> {
  const cfg = getAerieConfig() as any;
  const yaml = cfg.providers || {};

  // Dynamic import to avoid circular dependency at module load
  const { getSecret, setSecret, deleteSecret } = await import('./secrets.js');

  // A repaired key can be staged while an older backend process is still
  // running. That process must not see it: its pre-batching Archivist would
  // truncate an oversized backlog and advance past unseen messages. The new
  // build promotes the staged key on its first provider load, after safe
  // chronological batching is live.
  let ollamaKey = getSecret('ollama_api_key') || '';
  const yamlOllamaKey = yaml.ollama?.api_key || '';
  const pendingOllamaKey = getSecret('ollama_api_key_pending');
  if (!ollamaKey && yamlOllamaKey) {
    // A key saved through the older Providers route may still be in YAML on
    // the first restart. It is newer user intent than a staged recovery key.
    setSecret('ollama_api_key', yamlOllamaKey);
    ollamaKey = yamlOllamaKey;
  } else if (!ollamaKey && pendingOllamaKey) {
    setSecret('ollama_api_key', pendingOllamaKey);
    ollamaKey = pendingOllamaKey;
  }
  if (ollamaKey && pendingOllamaKey) deleteSecret('ollama_api_key_pending');

  // BYOK pattern: secrets store > yaml > env var (env handled in getSecret)
  // Jun 21, 2026: migrating provider keys into secrets table
  return {
    ollama: yaml.ollama ? {
      base_url: yaml.ollama.base_url,
      api_key: ollamaKey || yaml.ollama.api_key || '',
    } : undefined,
    anthropic: yaml.anthropic,
    openrouter: {
      api_key: getSecret('openrouter_api_key') || yaml.openrouter?.api_key || '',
    },
    groq: {
      api_key: getSecret('groq_api_key') || yaml.groq?.api_key || '',
      base_url: yaml.groq?.base_url,
    },
    xai: {
      api_key: getSecret('xai_api_key') || yaml.xai?.api_key || '',
      base_url: yaml.xai?.base_url,
    },
    openai: {
      api_key: getSecret('openai_api_key') || yaml.openai?.api_key || '',
      base_url: yaml.openai?.base_url,
    },
    huggingface: {
      api_key: getSecret('huggingface_api_key') || yaml.huggingface?.api_key || '',
      base_url: yaml.huggingface?.base_url,
    },
  };
}

/** List available provider/model combos based on config */
export function getAvailableProviders(config: ProviderConfig): string[] {
  const available: string[] = [];
  if (config.ollama?.base_url) available.push('ollama');
  if (config.anthropic?.api_key) available.push('anthropic');
  if (config.openrouter?.api_key) available.push('openrouter');
  if (config.groq?.api_key) available.push('groq');
  if (config.xai?.api_key) available.push('xai');
  if (config.openai?.api_key) available.push('openai');
  if (config.huggingface?.api_key) available.push('huggingface');
  return available;
}
