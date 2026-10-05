// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// The two model lists this house has to write out by hand — and the escape
// hatch that lets a new model be used on the day it ships.
//
// Every other provider in routes/models.ts is discovered at runtime by asking
// it what it has. The Claude and Codex lanes cannot be: both ride a
// subscription through a CLI, and a CLI has no models endpoint to ask. So the
// lists below are written out by hand, which means a model nobody has written
// down does not exist on the surface that actually gets used — the picker
// beside the chat is list-only, and the free-text box on the Archivist screen
// is somewhere else entirely.
//
// Two keys in the DB config store append to them, live: no code change, no
// build, no restart.
//
//   models.extra_claude   →  the Claude CLI lane
//   models.extra_codex    →  both Codex lanes (warm daemon and stateless)
//
// One entry per line; commas work too. The display name and the context
// window are optional:
//
//   claude-opus-6
//   claude-opus-6 | Opus 6
//   claude-opus-6 | Opus 6 | 1000000
//
// Give the context window when the model has one worth knowing about — it is
// what the meter measures against, and an unstated window falls back to 200k
// exactly as it does today for any id this file has never heard of.
//
// Nothing here checks an id against the provider. That is the whole point of
// an escape hatch: a wrong id fails at the lane, the same way a wrong id typed
// into this file would.

import { getConfig } from './db/config.js';

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  tier: 'free' | 'paid' | 'included' | 'local';
  description?: string;
  context_length?: number;
  supports_tools?: boolean;
  reasoning_levels?: string[];
  default_reasoning_level?: string;
  speed_tiers?: string[];
  /** Added by the owner through the picker rather than written down here. */
  custom?: boolean;
}

// Claude models available through the SDK — the SDK itself accepts any valid
// model string, but we list known current ones so the picker shows them.
// These are "included" tier because they come with your Claude subscription/SDK access.
export const CLAUDE_MODELS: ModelInfo[] = [
  // claude-opus-5-5 read off the installed CLI package (2.1.280) rather than guessed at.
  // A model id only works if the CLI on this box carries it: 2.1.197 had neither opus-5 nor
  // opus-5-5 in it, and a lane pointed at a model its CLI has never heard of dies on launch.
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', provider: 'anthropic', tier: 'included', context_length: 1000000, supports_tools: true },
  { id: 'claude-opus-5', name: 'Claude Opus 5', provider: 'anthropic', tier: 'included', context_length: 1000000, supports_tools: true },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', provider: 'anthropic', tier: 'included', context_length: 1000000, supports_tools: true },
  { id: 'claude-fable-5', name: 'Claude Fable 5', provider: 'anthropic', tier: 'included', context_length: 1000000, supports_tools: true },
  { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', provider: 'anthropic', tier: 'included', context_length: 1000000, supports_tools: true },
  { id: 'claude-opus-4-7', name: 'Claude Opus 4.7', provider: 'anthropic', tier: 'included', context_length: 1000000, supports_tools: true },
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', provider: 'anthropic', tier: 'included', context_length: 1000000, supports_tools: true },
  { id: 'claude-opus-4-5', name: 'Claude Opus 4.5', provider: 'anthropic', tier: 'included', context_length: 200000, supports_tools: true },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'anthropic', tier: 'included', context_length: 200000, supports_tools: true },
  { id: 'claude-sonnet-4-5-20241022', name: 'Claude Sonnet 4.5 (Oct)', provider: 'anthropic', tier: 'included', context_length: 200000, supports_tools: true },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', provider: 'anthropic', tier: 'included', context_length: 200000, supports_tools: true },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5 (Oct)', provider: 'anthropic', tier: 'included', context_length: 200000, supports_tools: true },
  { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', provider: 'anthropic', tier: 'included', context_length: 200000, supports_tools: true },
  { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', provider: 'anthropic', tier: 'included', context_length: 200000, supports_tools: true },
];

// Codex (ChatGPT OAuth via pi-ai Responses API).
// Model IDs must match pi-ai's openai-codex registry exactly.
// Consumer OAuth token uses the Responses API, NOT Chat Completions.
// Per Codex docs: gpt-5.2 and gpt-5.3-codex are DEPRECATED for ChatGPT sign-in.
export const CODEX_MODELS: ModelInfo[] = [
  // Gated by CLI version, not by account: the models endpoint returns it only to
  // clients >= 0.153.0, and an older CLI is told it does not exist rather than
  // that it cannot have it. Proven Sep 5 2026 by varying client_version alone.
  { id: 'gpt-6-astra', name: 'GPT-6 Astra', provider: 'codex', tier: 'paid', supports_tools: true },
  { id: 'gpt-6-sol', name: 'GPT-6 Sol', provider: 'codex', tier: 'paid', supports_tools: true },
  { id: 'gpt-6-luna', name: 'GPT-6 Luna', provider: 'codex', tier: 'paid', supports_tools: true },
  { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', provider: 'codex', tier: 'paid', supports_tools: true },
  { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', provider: 'codex', tier: 'paid', supports_tools: true },
  { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', provider: 'codex', tier: 'paid', supports_tools: true },
  // gpt-5.5 was removed Oct 1 2026: it retires on every plan on Oct 14 2026,
  // and the account names gpt-5.6-sol as its upgrade. Until then the account's
  // own list still carries it, so the picker keeps showing it from there.
  // gpt-5.4, gpt-5.4-mini and gpt-5.3-codex-spark were removed Sep 8 2026:
  // the account's own list has not carried them for some time and the picker
  // was offering three models the account could not run. This list is now only the
  // FALLBACK — services/codex-model-discovery.ts reads what the Codex CLI
  // fetched from the account, and this is what the picker shows when that file
  // is missing. Keep it maintained; do not treat it as the record.
];

// Codex CLI — the same models routed through the warm daemon session.
export const CODEX_CLI_MODELS: ModelInfo[] = CODEX_MODELS.map(m => ({
  ...m,
  name: `${m.name} (Warm)`,
  provider: 'codex-cli',
  tier: 'included' as const,
}));

export const EXTRA_MODEL_KEYS = {
  claude: 'models.extra_claude',
  codex: 'models.extra_codex',
} as const;

export type ModelLane = keyof typeof EXTRA_MODEL_KEYS;

export interface ExtraModel {
  id: string;
  name: string;
  contextLength?: number;
}

/**
 * Read one of the owner's extra-model lists. Pure and separately testable —
 * the shape of what they typed is the part that can go wrong.
 */
export function parseExtraModels(raw: string | null | undefined): ExtraModel[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: ExtraModel[] = [];
  for (const entry of raw.split(/[\n,]/)) {
    const line = entry.trim();
    if (!line || line.startsWith('#')) continue;
    const [rawId, rawName, rawContext] = line.split('|').map(part => part.trim());
    // An id with a space in it is a typo, not an id — and a typo that reached
    // the lane would take out the next turn rather than this line.
    if (!rawId || /\s/.test(rawId)) continue;
    if (seen.has(rawId)) continue;
    seen.add(rawId);
    const contextLength = Number(rawContext);
    out.push({
      id: rawId,
      name: rawName || rawId,
      contextLength: Number.isFinite(contextLength) && contextLength > 0 ? contextLength : undefined,
    });
  }
  return out;
}

/** The lane's built-in ids, for keeping an extra from listing itself twice. */
function builtInIds(lane: ModelLane): Set<string> {
  const list = lane === 'claude' ? CLAUDE_MODELS : CODEX_MODELS;
  return new Set(list.map(m => m.id));
}

/**
 * The owner's extras for a lane. Reads the DB at call time so a model added
 * from the picker is selectable on the next open — fails quiet if the database
 * is not up, the same way the Codex capability cache does.
 */
export function extraModelsFor(lane: ModelLane): ExtraModel[] {
  let raw: string | null = null;
  try {
    raw = getConfig(EXTRA_MODEL_KEYS[lane]);
  } catch {
    return [];
  }
  const builtIn = builtInIds(lane);
  return parseExtraModels(raw).filter(m => !builtIn.has(m.id));
}

/** Dress an extra as a model the picker can show. */
export function asModelInfo(
  extra: ExtraModel,
  over: { provider: string; tier: ModelInfo['tier']; nameSuffix?: string },
): ModelInfo {
  return {
    id: extra.id,
    name: over.nameSuffix ? `${extra.name}${over.nameSuffix}` : extra.name,
    provider: over.provider,
    tier: over.tier,
    context_length: extra.contextLength,
    supports_tools: true,
    custom: true,
  };
}

// ---------------------------------------------------------------------------
// Recognising an id that was typed rather than picked
// ---------------------------------------------------------------------------
//
// A CLI lane launches a subprocess with `--model <id>`. An id the CLI does not
// know is not an error message — the process exits and the supervisor relaunches
// it every two seconds, so the lane is simply gone and nothing says why.
//
// `Claude Opus 4.5` is printed beside `claude-opus-4-5` everywhere a person
// looks, and the two differ only in punctuation. So the comparison here throws
// punctuation away.

/** Lowercase, then drop everything that is not a letter or a digit, so a name
 *  and its id collapse to the same string: `Claude Opus 4.5` and
 *  `claude-opus-4-5` both become `claudeopus45`. */
export function normalizeModelId(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Ids that look like what was typed, best first. Used to answer an unknown id
 *  with the real one rather than only with a refusal. */
export function nearestModelIds(query: string, ids: string[], limit = 4): string[] {
  const q = normalizeModelId(query);
  if (!q) return [];
  const scored: Array<{ id: string; score: number }> = [];
  for (const id of ids) {
    const n = normalizeModelId(id);
    let score = -1;
    if (n === q) score = 0;              // same id, differently punctuated
    else if (n.startsWith(q)) score = 1; // a prefix of a real id
    else if (n.includes(q)) score = 2;   // the tail of one — `opus 4.5`
    else if (q.includes(n)) score = 3;   // an id with something extra on it
    if (score >= 0) scored.push({ id, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.id.length - b.id.length || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map(s => s.id);
}

/** Every model id this box can name without asking the network: the two
 *  hand-written CLI catalogs plus whatever the two extra-model config keys add.
 *
 *  Ollama, OpenRouter, xAI and OpenAI are discovered live by GET /api/models,
 *  so their ids are NOT in here. Absence from this list is not proof a model
 *  does not exist — only `routingHasLocalCatalog` says when it is. */
export function localModelIds(): string[] {
  const ids = new Set<string>();
  for (const m of CLAUDE_MODELS) ids.add(m.id);
  for (const m of CODEX_MODELS) ids.add(m.id);
  for (const m of CODEX_CLI_MODELS) ids.add(m.id);
  for (const lane of Object.keys(EXTRA_MODEL_KEYS) as ModelLane[]) {
    for (const m of extraModelsFor(lane)) ids.add(m.id);
  }
  return [...ids];
}

/** Whether an unknown id can honestly be refused on this routing.
 *
 *  True for the lanes whose whole list is written down here — which are also
 *  exactly the lanes that die on a bad id, because they launch a CLI with it.
 *  `api` and `auto` reach providers discovered at request time, so on those an
 *  id we do not recognise may still be perfectly real.
 *
 *  `sdk` is NOT one of them, and it was for a day. Neither half of the rule
 *  above holds there: the SDK takes any valid model string (see the note on
 *  CLAUDE_MODELS — the thirteen ids are what the picker shows, not the set that
 *  works), and it launches nothing, so a bad id fails one request instead of
 *  respawning a dead lane. Refusing there would turn an incomplete list into a
 *  restriction — the list has dated Sonnet 4.5 but not the plain id, so a real
 *  model would have come back as "nothing was changed". */
export function routingHasLocalCatalog(routing: string): boolean {
  return routing === 'cli' || routing === 'codex-cli';
}
