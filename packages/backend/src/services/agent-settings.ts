// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Persisting an `agent.*` setting so the running house actually picks it up.
//
// There are three places one of these values lives and all three have to move
// together: the DB config row (what the settings screen reads back), the
// in-memory config (what the current process dispatches from), and aerie.yaml
// (what survives a restart, and what getAerieConfig re-reads).
//
// The settings route did all three inline. The /model slash command did only
// the first, which is the one nothing dispatches from — so it wrote a row
// nobody reads, left the live model untouched, and reported success. Worse,
// reading it back preferred the DB row, so it then quoted the value it had
// failed to set. One function, used by both, is the fix.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';
import { setConfig } from './db.js';
import { updateConfigValue, PROJECT_ROOT } from '../config.js';
import { resolveCompatibleAgentRoute, type AgentRouting } from './agent/agent-route-selection.js';

/** aerie.yaml, found the same way config.ts loads it — from PROJECT_ROOT
 *  rather than cwd, which is not the same directory under pm2. */
export function findConfigPath(): string | null {
  for (const name of ['aerie.yaml', 'aerie.yml']) {
    const p = join(PROJECT_ROOT, name);
    if (existsSync(p)) return p;
  }
  return null;
}

// Only these reach the YAML. A key that is not here still lands in the DB and
// in memory; it simply does not survive a restart, which is correct for
// anything the config file has no home for.
const YAML_KEYS = new Set([
  'agent.model',
  'agent.model_autonomous',
  'agent.model_pulse',
  'agent.thinking',
  'agent.effort',
  'agent.claude_thinking',
  'agent.claude_effort',
  'agent.codex_effort',
  'agent.codex_speed',
  'agent.routing',
  'agent.routing_autonomous',
]);

export function persistAgentSetting(key: string, value: string): void {
  setConfig(key, value);
  if (!key.startsWith('agent.')) return;

  updateConfigValue(key, value);
  if (!YAML_KEYS.has(key)) return;

  const configPath = findConfigPath();
  if (!configPath) return;

  const parsed = (yaml.load(readFileSync(configPath, 'utf-8')) as Record<string, any>) || {};
  if (!parsed.agent) parsed.agent = {};
  parsed.agent[key.slice('agent.'.length)] = value;
  writeFileSync(
    configPath,
    yaml.dump(parsed, { lineWidth: -1, quoteStyle: 'double', forceQuotes: true }),
    'utf-8',
  );
}

/**
 * A warm model and its route are one selection, even though config stores them
 * as two keys. Keeping this pairing at the persistence boundary prevents a
 * slash-command model switch from leaving every later turn to repair the same
 * incompatible route in memory.
 *
 * The writer parameter keeps the decision pure enough to pin in tests without
 * standing up the database or rewriting the real config file.
 */
export function persistAgentModelSelection(
  model: string,
  requestedRouting: AgentRouting,
  write: (key: string, value: string) => void = persistAgentSetting,
): AgentRouting {
  const routing = resolveCompatibleAgentRoute(model, requestedRouting).routing;
  write('agent.model', model);
  if (routing !== requestedRouting) write('agent.routing', routing);
  return routing;
}
