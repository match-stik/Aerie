// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * What the owner's Codex account can actually run — read rather than remembered.
 *
 * CODEX_MODELS in model-catalog.ts is written out by hand because a CLI has no
 * models endpoint to ask. That is true of the CLI and NOT true of the account:
 * the Codex CLI itself fetches the list from chatgpt.com and leaves it on disk
 * at ~/.codex/models_cache.json, refreshed on its own schedule. So there is a
 * local witness, and the hand-typed list has been drifting away from it — the
 * picker once offered the owner gpt-5.4, gpt-5.4-mini and gpt-5.3-codex-spark, none
 * of which their account had had for some time.
 *
 * This reads that cache. It is deliberately not a network call: Codex owns the
 * refresh, the file needs no token handling, and a route that can hang on
 * chatgpt.com is a worse picker than a slightly stale one. When the file is
 * absent or unreadable the caller falls back to the hand-typed list, which is
 * why that list stays maintained rather than deleted.
 */
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { ModelInfo } from './model-catalog.js';

/**
 * Slugs the account exposes that are not the owner's to pick. gpt-reserve is the
 * fallback pool the provider routes to under pressure; codex-auto-review is
 * the internal reviewer the CLI drives itself. Both answer as models and
 * neither is a choice — an explicit list rather than a heuristic, so a new
 * model is offered by default instead of silently swallowed by a pattern.
 */
const NOT_SELECTABLE = new Set(['gpt-reserve', 'codex-auto-review']);

interface CachedCodexModel {
  slug?: unknown;
  display_name?: unknown;
  context_window?: unknown;
}

/** Map one cache row to a picker entry, or null if it is not one. */
export function codexModelFromCache(row: CachedCodexModel, provider: 'codex' | 'codex-cli'): ModelInfo | null {
  const id = typeof row?.slug === 'string' ? row.slug.trim() : '';
  if (!id || NOT_SELECTABLE.has(id)) return null;
  const display = typeof row.display_name === 'string' && row.display_name.trim() ? row.display_name.trim() : id;
  const contextWindow = typeof row.context_window === 'number' && row.context_window > 0 ? row.context_window : undefined;
  return {
    id,
    name: provider === 'codex-cli' ? `${display} (Warm)` : display,
    provider,
    tier: provider === 'codex-cli' ? 'included' : 'paid',
    supports_tools: true,
    ...(contextWindow ? { context_length: contextWindow } : {}),
  };
}

/** The picker entries a parsed cache yields. Empty means "no witness" — fall back. */
export function codexModelsFromCache(parsed: unknown, provider: 'codex' | 'codex-cli'): ModelInfo[] {
  const rows = (parsed as { models?: unknown })?.models;
  if (!Array.isArray(rows)) return [];
  const out: ModelInfo[] = [];
  for (const row of rows) {
    const model = codexModelFromCache(row as CachedCodexModel, provider);
    if (model) out.push(model);
  }
  return out;
}

export function codexModelCachePath(): string {
  return join(homedir(), '.codex', 'models_cache.json');
}

/**
 * Read the cache off disk. Returns an empty array for every failure — absent
 * file, unreadable, malformed — so the caller's fallback is the single place
 * that decides what an empty answer means.
 */
export function discoverCodexModels(provider: 'codex' | 'codex-cli'): ModelInfo[] {
  try {
    return codexModelsFromCache(JSON.parse(readFileSync(codexModelCachePath(), 'utf8')), provider);
  } catch {
    return [];
  }
}
