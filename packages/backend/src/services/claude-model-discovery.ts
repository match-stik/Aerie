// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
/**
 * What the signed-in Claude account can run, read off Anthropic rather than
 * typed out by hand (asked for Nov 26 2026, the way Codex already reads its
 * account's list). Claude Code's own login answers GET /v1/models, and that
 * reply carries each model's name and its context window.
 *
 * It never refreshes the login. The lanes share that token, and a refresh from
 * here could rotate it out from under them (the usage meter learned this on
 * Nov 24 2026), so an expired or missing token means the last list read is
 * shown instead, kept in the config store so a restart has it too. When there
 * has never been a good read, the caller falls back to CLAUDE_MODELS.
 */
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { getConfig, setConfig } from './db/config.js';
import { CLAUDE_MODELS, type ModelInfo } from './model-catalog.js';

const CACHE_KEY = 'models.claude_account_cache';
const FRESH_MS = 60 * 60 * 1000;
let memo: { at: number; models: ModelInfo[] } | null = null;

interface AnthropicModelRow {
  id?: unknown;
  display_name?: unknown;
  max_input_tokens?: unknown;
}

/** Anthropic's /v1/models reply turned into picker rows, newest first as Anthropic sends them. */
export function claudeModelsFromApi(parsed: unknown): ModelInfo[] {
  const rows = (parsed as { data?: unknown })?.data;
  if (!Array.isArray(rows)) return [];
  const known = new Map(CLAUDE_MODELS.map((m) => [m.id, m]));
  const out: ModelInfo[] = [];
  for (const row of rows as AnthropicModelRow[]) {
    if (typeof row?.id !== 'string' || !row.id.startsWith('claude-')) continue;
    const id = row.id;
    const name = typeof row.display_name === 'string' && row.display_name.trim() ? row.display_name.trim() : known.get(id)?.name ?? id;
    const window = typeof row.max_input_tokens === 'number' && row.max_input_tokens > 0
      ? row.max_input_tokens
      : known.get(id)?.context_length ?? 200000;
    out.push({ id, name, provider: 'anthropic', tier: 'included', context_length: window, supports_tools: true });
  }
  return out;
}

interface Token { accessToken: string; expiresAt: number | null }

function readToken(): Token | null {
  try {
    const raw = JSON.parse(readFileSync(join(homedir(), '.claude', '.credentials.json'), 'utf8')) as {
      claudeAiOauth?: { accessToken?: unknown; expiresAt?: unknown };
    };
    const oauth = raw.claudeAiOauth;
    if (!oauth || typeof oauth.accessToken !== 'string' || !oauth.accessToken) return null;
    return { accessToken: oauth.accessToken, expiresAt: typeof oauth.expiresAt === 'number' ? oauth.expiresAt : null };
  } catch {
    return null;
  }
}

function lastGood(): ModelInfo[] {
  try {
    const cached = JSON.parse(getConfig(CACHE_KEY) || '[]');
    return Array.isArray(cached) ? (cached as ModelInfo[]) : [];
  } catch {
    return [];
  }
}

/**
 * The account's Claude models, or [] when they have never been read. Reads at
 * most once an hour; a failed or skipped read hands back the last good list.
 */
export async function discoverClaudeModels(
  fetchImpl: typeof fetch = fetch,
  now = Date.now(),
  token: Token | null = readToken(),
): Promise<ModelInfo[]> {
  if (memo && now - memo.at < FRESH_MS) return memo.models;
  const fallback = lastGood();
  // A token past its expiry is left alone: refreshing is the lanes' job.
  if (!token || (token.expiresAt !== null && token.expiresAt <= now)) return fallback;
  try {
    const res = await fetchImpl('https://api.anthropic.com/v1/models?limit=100', {
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'oauth-2025-04-20',
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return fallback;
    const models = claudeModelsFromApi(await res.json());
    if (models.length === 0) return fallback;
    memo = { at: now, models };
    setConfig(CACHE_KEY, JSON.stringify(models));
    return models;
  } catch {
    return fallback;
  }
}

/** For tests: forget the hour's memo. */
export function resetClaudeModelMemo(): void {
  memo = null;
}
