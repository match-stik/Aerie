// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * MCP Client — proper MCP protocol handshake for discovery and tool execution.
 *
 * Ported from Haven's dual-transport MCP implementation.
 * Supports Streamable HTTP (primary) with SSE fallback.
 *
 * Protocol sequence:
 *   1. POST initialize (with protocolVersion + clientInfo)
 *   2. POST notifications/initialized (required by spec)
 *   3. POST tools/list (discovery) or tools/call (execution)
 */


export interface McpToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  transport: 'streamable' | 'sse';
}

// ─── Content block helpers ──────────────────────────────────────

/**
 * Serialize MCP content blocks to a string.
 *
 * When image blocks are present, returns the full content array as JSON
 * so downstream consumers (e.g. codex runtime's parseToolResultContent)
 * can extract base64 data and convert to proper image content blocks.
 *
 * When no images are present, returns plain text for readability.
 */
function serializeContentBlocks(content: any[]): string {
  const hasImages = content.some(
    (c: any) => c.type === 'image' || c.type === 'image_url',
  );
  if (hasImages) {
    // Preserve the raw content array as JSON — image data intact
    return JSON.stringify(content);
  }
  // Text-only: join as readable text
  return content.map(contentBlockToText).join('\n');
}

function contentBlockToText(c: any): string {
  if (c.text) return c.text;
  if (c.type === 'resource' && c.resource?.blob) {
    const mime = c.resource.mimeType || 'binary';
    return `[resource: ${mime}]`;
  }
  return JSON.stringify(c);
}

// ─── Streamable HTTP helpers ────────────────────────────────────

/**
 * Parse a Streamable HTTP response that may be JSON or SSE-wrapped JSON.
 * MCP 2025-03-26 servers can negotiate response format via Accept header.
 */
async function parseStreamableResponse(resp: Response): Promise<any> {
  const ct = resp.headers.get('content-type') || '';
  if (ct.includes('text/event-stream')) {
    const text = await resp.text();
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      try {
        return JSON.parse(trimmed.slice(5).trim());
      } catch { /* skip non-JSON lines */ }
    }
    throw new Error('streamable SSE response had no JSON-RPC payload');
  }
  return await resp.json();
}

function buildHeaders(apiKey?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  return headers;
}

async function mcpHandshake(
  url: string,
  headers: Record<string, string>,
): Promise<Record<string, string>> {
  const initResp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'aerie', version: '1.0.0' },
      },
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!initResp.ok) {
    const errBody = await initResp.text().catch(() => '');
    throw new Error(`initialize ${initResp.status}: ${errBody.slice(0, 200)}`);
  }

  const sessionId = initResp.headers.get('mcp-session-id');
  const sessionHeaders = { ...headers };
  if (sessionId) sessionHeaders['mcp-session-id'] = sessionId;

  // notifications/initialized — required by spec before any other request
  await fetch(url, {
    method: 'POST',
    headers: sessionHeaders,
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    signal: AbortSignal.timeout(5000),
  });

  return sessionHeaders;
}

// ─── Streamable HTTP transport ──────────────────────────────────

async function discoverViaStreamableHTTP(
  url: string,
  apiKey?: string | null,
): Promise<McpToolSchema[]> {
  const headers = buildHeaders(apiKey);
  const sessionHeaders = await mcpHandshake(url, headers);

  const listResp = await fetch(url, {
    method: 'POST',
    headers: sessionHeaders,
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    signal: AbortSignal.timeout(15000),
  });

  if (!listResp.ok) {
    const errBody = await listResp.text().catch(() => '');
    throw new Error(`tools/list ${listResp.status}: ${errBody.slice(0, 200)}`);
  }

  const data = await parseStreamableResponse(listResp);
  const tools = data?.result?.tools || [];
  return tools.map((t: any) => ({
    name: t.name,
    description: t.description || '',
    inputSchema: t.inputSchema || { type: 'object', properties: {} },
    transport: 'streamable' as const,
  }));
}

async function executeViaStreamableHTTP(
  url: string,
  apiKey: string | null,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const headers = buildHeaders(apiKey);
  const sessionHeaders = await mcpHandshake(url, headers);

  const resp = await fetch(url, {
    method: 'POST',
    headers: sessionHeaders,
    body: JSON.stringify({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: toolName, arguments: args },
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '');
    throw new Error(`tools/call ${resp.status}: ${errBody.slice(0, 200)}`);
  }

  const data = await parseStreamableResponse(resp);
  if (data?.error) {
    return `Tool error: ${data.error.message || JSON.stringify(data.error)}`;
  }
  const content = data?.result?.content || [];
  return (content.length > 0 ? serializeContentBlocks(content) : null) || JSON.stringify(data?.result || {});
}

// ─── SSE transport (fallback) ───────────────────────────────────

interface SSEEvent {
  event: string;
  data: string;
}

async function readSSEUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  buffer: string,
  predicate: (event: SSEEvent) => boolean,
  timeoutMs = 15000,
): Promise<{ event: SSEEvent; buffer: string }> {
  const deadline = Date.now() + timeoutMs;
  let currentEvent = '';
  let currentData = '';

  while (Date.now() < deadline) {
    const { done, value } = await reader.read();
    if (done) throw new Error('SSE stream ended before matching event');

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '') {
        // End of event
        if (currentData) {
          const evt: SSEEvent = { event: currentEvent || 'message', data: currentData };
          if (predicate(evt)) return { event: evt, buffer };
        }
        currentEvent = '';
        currentData = '';
      } else if (trimmed.startsWith('event:')) {
        currentEvent = trimmed.slice(6).trim();
      } else if (trimmed.startsWith('data:')) {
        currentData += (currentData ? '\n' : '') + trimmed.slice(5).trim();
      }
    }
  }
  throw new Error('SSE read timed out');
}

async function openSSESession(url: string, apiKey?: string | null): Promise<{
  reader: ReadableStreamDefaultReader<Uint8Array>;
  decoder: TextDecoder;
  buffer: string;
  endpointUrl: string;
  postHeaders: Record<string, string>;
}> {
  const sseHeaders: Record<string, string> = { Accept: 'text/event-stream' };
  if (apiKey) sseHeaders['Authorization'] = `Bearer ${apiKey}`;

  const sseResp = await fetch(url, { headers: sseHeaders, signal: AbortSignal.timeout(10000) });
  if (!sseResp.ok || !sseResp.body) {
    const errBody = await sseResp.text().catch(() => '');
    throw new Error(`sse connect ${sseResp.status}: ${errBody.slice(0, 200)}`);
  }

  const ct = sseResp.headers.get('content-type') || '';
  if (!ct.includes('text/event-stream')) {
    try { await sseResp.body.cancel(); } catch {}
    throw new Error(`sse expected event-stream, got ${ct || 'unknown'}`);
  }

  const reader = sseResp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // First event is `event: endpoint` with the POST path
  const endpointRead = await readSSEUntil(reader, decoder, buffer, e => e.event === 'endpoint');
  buffer = endpointRead.buffer;
  const endpointUrl = new URL(endpointRead.event.data.trim(), url).toString();

  const postHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) postHeaders['Authorization'] = `Bearer ${apiKey}`;

  return { reader, decoder, buffer, endpointUrl, postHeaders };
}

async function readSSEJsonRpc(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  buffer: string,
  id: number,
): Promise<{ data: any; buffer: string }> {
  const read = await readSSEUntil(reader, decoder, buffer, e => {
    try { return JSON.parse(e.data).id === id; } catch { return false; }
  });
  return { data: JSON.parse(read.event.data), buffer: read.buffer };
}

async function discoverViaSSE(url: string, apiKey?: string | null): Promise<McpToolSchema[]> {
  const session = await openSSESession(url, apiKey);
  let buffer = session.buffer;
  try {
    // initialize
    await fetch(session.endpointUrl, {
      method: 'POST', headers: session.postHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'aerie', version: '1.0.0' } },
      }),
    });
    const initRead = await readSSEJsonRpc(session.reader, session.decoder, buffer, 1);
    buffer = initRead.buffer;

    // notifications/initialized
    await fetch(session.endpointUrl, {
      method: 'POST', headers: session.postHeaders,
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });

    // tools/list
    await fetch(session.endpointUrl, {
      method: 'POST', headers: session.postHeaders,
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    });
    const toolsRead = await readSSEJsonRpc(session.reader, session.decoder, buffer, 2);

    const tools = toolsRead.data?.result?.tools || [];
    return tools.map((t: any) => ({
      name: t.name,
      description: t.description || '',
      inputSchema: t.inputSchema || { type: 'object', properties: {} },
      transport: 'sse' as const,
    }));
  } finally {
    session.reader.cancel().catch(() => {});
  }
}

async function executeViaSSE(
  url: string,
  apiKey: string | null,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const session = await openSSESession(url, apiKey);
  let buffer = session.buffer;
  try {
    await fetch(session.endpointUrl, {
      method: 'POST', headers: session.postHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'aerie', version: '1.0.0' } },
      }),
    });
    const initRead = await readSSEJsonRpc(session.reader, session.decoder, buffer, 1);
    buffer = initRead.buffer;

    await fetch(session.endpointUrl, {
      method: 'POST', headers: session.postHeaders,
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });

    await fetch(session.endpointUrl, {
      method: 'POST', headers: session.postHeaders,
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: toolName, arguments: args } }),
    });
    const callRead = await readSSEJsonRpc(session.reader, session.decoder, buffer, 2);

    if (callRead.data?.error) {
      return `Tool error: ${callRead.data.error.message || JSON.stringify(callRead.data.error)}`;
    }
    const content = callRead.data?.result?.content || [];
    return (content.length > 0 ? serializeContentBlocks(content) : null) || JSON.stringify(callRead.data?.result || {});
  } finally {
    session.reader.cancel().catch(() => {});
  }
}

// ─── API Key resolution ────────────────────────────────────────

async function resolveApiKey(url: string, apiKey?: string | null): Promise<string | null> {
  return apiKey ?? null;
}

// ─── Public API ─────────────────────────────────────────────────

/**
 * Discover tools from an MCP server.
 * Tries Streamable HTTP first, falls back to SSE.
 */
export async function discoverMcpTools(
  url: string,
  apiKey?: string | null,
): Promise<McpToolSchema[]> {
  const resolvedKey = await resolveApiKey(url, apiKey);
  let streamableErr: unknown;
  try {
    return await discoverViaStreamableHTTP(url, resolvedKey);
  } catch (e) {
    streamableErr = e;
  }
  try {
    return await discoverViaSSE(url, resolvedKey);
  } catch (sseErr) {
    throw new Error(
      `MCP discovery failed — streamable: ${streamableErr instanceof Error ? streamableErr.message : streamableErr}; ` +
      `sse: ${sseErr instanceof Error ? sseErr.message : sseErr}`,
    );
  }
}

/**
 * Execute a tool on an MCP server.
 * Uses the specified transport (defaults to streamable).
 */
export async function executeMcpTool(
  url: string,
  apiKey: string | null,
  toolName: string,
  args: Record<string, unknown>,
  transport: 'streamable' | 'sse' = 'streamable',
): Promise<{ result: string; ok: boolean }> {
  const resolvedKey = await resolveApiKey(url, apiKey);
  try {
    const result = transport === 'sse'
      ? await executeViaSSE(url, resolvedKey, toolName, args)
      : await executeViaStreamableHTTP(url, resolvedKey, toolName, args);
    return { result, ok: !result.startsWith('Tool error') };
  } catch (err) {
    return { result: `Tool error: ${err instanceof Error ? err.message : String(err)}`, ok: false };
  }
}
