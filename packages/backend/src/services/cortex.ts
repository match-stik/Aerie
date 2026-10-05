// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// cortex.ts — Native Cortex integration
// Direct API calls to the Cortex Cloudflare Worker
// No MCP bridge — these are first-class backend functions

import { getAerieConfig } from '../config.js';
import { getSecret } from './secrets.js';

function getCortexUrl(): string {
  // BYOK: the DB-backed secrets store is canonical (getSecret also covers
  // the CORTEX_URL env fallback). yaml + CORTEX_WORKER_URL remain as
  // legacy fallbacks for older deployments.
  const config = getAerieConfig();
  const url = getSecret('cortex_mcp_url') || config.integrations?.cortex?.mcp_url || process.env.CORTEX_WORKER_URL;
  if (!url) {
    throw new Error('Cortex not configured. Set the Cortex worker URL in Memory → Cortex.');
  }
  return url.replace(/\/+$/, '');
}

interface CortexResponse {
  content: Array<{ type: string; text: string }>;
}

function refreshLocalMemoryMirror(): void {
  void import('./cortex-memory-index.js')
    .then(({ scheduleCortexMemoryIndexRefresh }) => scheduleCortexMemoryIndexRefresh())
    .catch(() => { /* semantic mirror is optional and fail-quiet */ });
}

// Bearer token for the auth-gated Cortex worker (BYOK secrets store, key
// 'cortex_auth_token'). Empty until set — the worker only enforces once its
// own CORTEX_AUTH_TOKEN secret exists, so this stays backward-compatible.
function cortexAuthHeaders(): Record<string, string> {
  const token = getSecret('cortex_auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface CortexProbe {
  /** A worker URL is set. Without one there is no row to draw at all. */
  configured: boolean;
  /** It answered. */
  ok: boolean;
  /** Short, for a toast — the status code or the failure's own words. */
  detail: string;
}

/**
 * Pure: why did reading the Cortex config fail?
 *
 * Only one answer means "the owner has not set this up" — the message getCortexUrl
 * raises when no URL is stored. Everything else (a database not open, a config
 * read that threw) is UNKNOWN, and reporting unknown as unconfigured is exactly
 * the false negative this readout was rebuilt to stop telling: it would drop
 * the brain silently out of the list instead of saying it could not be checked.
 *
 * Found because a probe run in a scratch process reported "no worker URL set"
 * when the URL was sitting in the database the whole time — the read had
 * thrown, and the catch called that absence.
 */
export function classifyCortexConfigError(message: string): CortexProbe {
  if (/not configured/i.test(message)) {
    return { configured: false, ok: false, detail: 'no worker URL set' };
  }
  return { configured: true, ok: false, detail: `could not read config: ${message.slice(0, 60)}` };
}

/**
 * Is the brain reachable right now, by the road the house actually uses?
 *
 * Cortex does not arrive as an MCP server on a warm CLI lane. The session loads
 * its own servers and Cortex is not among them, so every readout built from the
 * CLI's per-server logs is structurally blind to it — it leaves no line there to
 * find. It has always come through here instead: this backend, holding the
 * bearer token, calling the worker. The recycle's "Cortex returned: N recent"
 * is that same road succeeding.
 *
 * The cost of that split was that the brain was invisible in the one screen the
 * owner opens to see what is connected, which defeats the point of the screen.
 * This is the positive witness for the other road.
 */
export async function probeCortex(timeoutMs = 4000): Promise<CortexProbe> {
  let url: string;
  try { url = getCortexUrl(); }
  catch (err) { return classifyCortexConfigError(err instanceof Error ? err.message : String(err)); }

  try {
    const response = await fetch(`${url}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cortexAuthHeaders() },
      body: JSON.stringify({ method: 'tools/list', params: {}, id: crypto.randomUUID() }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      // 401 is the one worth naming: it means the worker is up and the token is
      // wrong or missing, which is a different repair from the worker being down.
      const why = response.status === 401 ? 'rejected the token' : `HTTP ${response.status}`;
      return { configured: true, ok: false, detail: why };
    }
    return { configured: true, ok: true, detail: 'answered' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { configured: true, ok: false, detail: message.slice(0, 80) };
  }
}

async function callTool(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const cortexUrl = getCortexUrl();
  const response = await fetch(`${cortexUrl}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...cortexAuthHeaders() },
    body: JSON.stringify({
      method: 'tools/call',
      params: { name, arguments: args },
      id: crypto.randomUUID(),
    }),
  });

  if (!response.ok) {
    throw new Error(`Cortex error: ${response.status} ${response.statusText}`);
  }

  // JSON-RPC reports tool failures inside a 200, so an unknown or broken tool
  // used to come back here as an empty string and get wrapped as a success.
  // That is how two dead tools went unnoticed for months. Surface it instead.
  const data = await response.json() as { result?: CortexResponse; error?: { message?: string; code?: number } };
  if (data.error) {
    throw new Error(`Cortex tool '${name}' failed: ${data.error.message || `code ${data.error.code}`}`);
  }
  if (!data.result) {
    throw new Error(`Cortex tool '${name}' returned no result — the worker may not implement it.`);
  }
  return data.result.content?.[0]?.text || '';
}

/**
 * Some operations exist on the worker as plain REST rather than as MCP tools.
 * Editing and deleting a memory are two of them.
 */
async function callRest(path: string, init: RequestInit = {}): Promise<string> {
  const cortexUrl = getCortexUrl();
  const response = await fetch(`${cortexUrl}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...cortexAuthHeaders(), ...(init.headers || {}) },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Cortex error: ${response.status} ${body.slice(0, 200)}`);
  return body;
}

// ── Cognitive Prosthetic ────────────────────────────────────

export async function rememberThought(content: string, domain?: string): Promise<string> {
  const result = await callTool('remember_thought', { content, domain });
  refreshLocalMemoryMirror();
  return result;
}

// These two were calling MCP tools the worker has never implemented, which
// returned nothing and reported success — so editing or deleting a memory from
// the Memory app silently did nothing. The worker has always exposed both as
// REST, so use that.
export async function editVaultEntry(id: string, content?: string, domain?: string): Promise<string> {
  const patch: Record<string, string> = {};
  if (typeof content === 'string') patch.content = content;
  if (typeof domain === 'string') patch.domain = domain;
  if (Object.keys(patch).length === 0) throw new Error('Nothing to change — pass content or domain.');
  await callRest(`/api/memory/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
  refreshLocalMemoryMirror();
  return `Updated memory ${id}`;
}

export async function deleteVaultEntry(id: string): Promise<string> {
  await callRest(`/api/memory/${encodeURIComponent(id)}`, { method: 'DELETE' });
  refreshLocalMemoryMirror();
  return `Deleted memory ${id}`;
}

export async function tunnelState(domain: string): Promise<string> {
  return callTool('tunnel_state', { domain });
}

export async function contextRecovery(domain: string): Promise<string> {
  return callTool('context_recovery', { domain });
}

export async function switchingCost(fromDomain: string, toDomain: string): Promise<string> {
  return callTool('switching_cost', { from_domain: fromDomain, to_domain: toDomain });
}

export async function openThreads(domain?: string): Promise<string> {
  return callTool('open_threads', { domain });
}

export async function dormantContexts(daysInactive?: number): Promise<string> {
  return callTool('dormant_contexts', { days_inactive: daysInactive });
}

export async function cognitivePatterns(): Promise<string> {
  return callTool('cognitive_patterns', {});
}

export async function tunnelHistory(domain: string): Promise<string> {
  return callTool('tunnel_history', { domain });
}

// ── Search ──────────────────────────────────────────────────

export async function recallMemories(query: string, domain?: string, limit?: number): Promise<string> {
  return callTool('recall_memories', { query, domain, limit });
}

export async function searchConversations(query: string, domain?: string, limit?: number): Promise<string> {
  return callTool('search_conversations', { query, domain, limit });
}

export async function unifiedSearch(query: string, limit?: number): Promise<string> {
  return callTool('unified_search', { query, limit });
}

export async function searchSummaries(query: string, domain?: string): Promise<string> {
  return callTool('search_summaries', { query, domain });
}

export async function searchDocs(query: string, domain?: string, limit?: number): Promise<string> {
  return callTool('search_docs', { query, domain, limit });
}

export async function unfinishedThreads(domain?: string): Promise<string> {
  return callTool('unfinished_threads', { domain });
}

// ── Synthesis ───────────────────────────────────────────────

export async function whatDoIThink(topic: string): Promise<string> {
  return callTool('what_do_i_think', { topic });
}

export async function alignmentCheck(decision: string, domain?: string): Promise<string> {
  return callTool('alignment_check', { decision, domain });
}

export async function thinkingTrajectory(topic: string): Promise<string> {
  return callTool('thinking_trajectory', { topic });
}

export async function whatWasIThinking(month?: string): Promise<string> {
  return callTool('what_was_i_thinking', { month });
}

// ── Conversations ───────────────────────────────────────────

export async function saveConversation(title: string, content: string, domain?: string, summary?: string): Promise<string> {
  return callTool('save_conversation', { title, content, domain, summary });
}

export async function getConversation(id: string): Promise<string> {
  return callTool('get_conversation', { id });
}

export async function conversationsByDate(startDate: string, endDate?: string, domain?: string): Promise<string> {
  return callTool('conversations_by_date', { start_date: startDate, end_date: endDate, domain });
}

// ── Stats ───────────────────────────────────────────────────

export async function brainStats(): Promise<string> {
  return callTool('brain_stats', {});
}

export async function queryAnalytics(): Promise<string> {
  return callTool('query_analytics', {});
}

// ── Principles ──────────────────────────────────────────────

export async function listPrinciples(domain?: string): Promise<string> {
  return callTool('list_principles', { domain });
}

export async function savePrinciple(name: string, content: string, domain?: string): Promise<string> {
  return callTool('save_principle', { name, content, domain });
}

// ── Raw Listing (MCP tools for browsing) ────────────────────

interface MemoryEntry {
  id: string;
  content: string;
  domain: string;
  category: string;
  created_at: string;
}

interface ListMemoriesResponse {
  results: MemoryEntry[];
  total: number;
}

export async function listDomainMemories(domain: string, limit = 500, offset = 0): Promise<ListMemoriesResponse> {
  const raw = await callTool('list_domain_memories', { domain, limit, offset });
  return JSON.parse(raw) as ListMemoriesResponse;
}

export async function listAllMemories(limit = 500, offset = 0): Promise<ListMemoriesResponse> {
  const raw = await callTool('list_all_memories', { limit, offset });
  return JSON.parse(raw) as ListMemoriesResponse;
}

// ── Health Check ────────────────────────────────────────────

export async function ping(): Promise<boolean> {
  try {
    const cortexUrl = getCortexUrl();
    const response = await fetch(cortexUrl);
    return response.ok;
  } catch {
    return false;
  }
}

export function isConfigured(): boolean {
  try {
    getCortexUrl();
    return true;
  } catch {
    return false;
  }
}
