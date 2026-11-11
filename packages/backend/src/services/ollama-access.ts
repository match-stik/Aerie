// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Which Ollama Cloud models this account can actually run (theirs, Nov 8 2026:
// 'let's drop it to the 7'). ollama.com's model list is its whole public
// catalog and comes back the same with or without a key, so the picker was
// offering 26 models on a free plan that runs 7; the other 19 answer 402
// ('not included in your free usage') or are not chat models at all. The only
// witness is the account itself, so each model is asked one word once a day
// and the picker shows the ones that answered. A plan change shows up on the
// next check with nobody touching anything. Local Ollama is never filtered.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import { PROJECT_ROOT } from '../config.js';

export interface OllamaAccess {
  /** When the account was last asked, ms. */
  checkedAt: number;
  /** Models that answered. */
  ok: string[];
  /** Models the account refused, with the reason it gave. */
  blocked: Record<string, string>;
}

const FILE = join(PROJECT_ROOT, 'data', 'ollama-access.json');
const DAY_MS = 24 * 60 * 60 * 1000;

/** Only the cloud has plans; a box running its own Ollama runs everything it has. */
export function isOllamaCloud(baseUrl: string): boolean {
  try { return /(^|\.)ollama\.com$/i.test(new URL(baseUrl).hostname); } catch { return false; }
}

/** What one probe's answer means: the account can run it, it can't, or the
 *  probe itself failed (network, a server error), which says nothing. */
export function classifyProbe(status: number, body: string): 'ok' | 'blocked' | 'unknown' {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 402 || status === 403) return 'blocked';
  // A model that is not a chat model ('only supports /v1/systemone') can never answer in the picker.
  if (status === 400 && /only supports|not a chat|does not support chat/i.test(body)) return 'blocked';
  return 'unknown';
}

/** The picker's list after the account has had its say: a model it refused is
 *  dropped; one never asked about (new since the last check) stays, so a new
 *  model is never hidden by a check that hasn't seen it yet. */
export function filterByAccess(models: string[], access: OllamaAccess | null): string[] {
  if (!access) return models;
  return models.filter((m) => !(m in access.blocked));
}

export function readAccess(file = FILE): OllamaAccess | null {
  try {
    if (!existsSync(file)) return null;
    const d = JSON.parse(readFileSync(file, 'utf8')) as OllamaAccess;
    if (typeof d.checkedAt !== 'number' || !Array.isArray(d.ok) || typeof d.blocked !== 'object' || !d.blocked) return null;
    return d;
  } catch { return null; }
}

function writeAccess(a: OllamaAccess, file = FILE) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(a, null, 2));
  renameSync(tmp, file);
}

/** Whether the record is old enough, or the catalog new enough, to ask again. */
export function needsCheck(models: string[], access: OllamaAccess | null, now = Date.now()): boolean {
  if (!access) return true;
  if (now - access.checkedAt > DAY_MS) return true;
  return models.some((m) => !access.ok.includes(m) && !(m in access.blocked));
}

let running: Promise<void> | null = null;

/** Ask the account about every model, one at a time (a free plan runs one
 *  request at a time), each a one-word hello capped at one word back. Runs in
 *  the background; only one check at a time. */
export function refreshAccess(baseUrl: string, apiKey: string, models: string[]): Promise<void> {
  if (running) return running;
  running = (async () => {
    const prev = readAccess();
    const ok: string[] = [];
    const blocked: Record<string, string> = {};
    for (const model of models) {
      let verdict: 'ok' | 'blocked' | 'unknown' = 'unknown';
      let reason = '';
      try {
        const res = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], stream: false, think: false, options: { num_predict: 1 } }),
          signal: AbortSignal.timeout(60_000),
        });
        const body = await res.text();
        verdict = classifyProbe(res.status, body);
        reason = `${res.status} ${body.slice(0, 160)}`;
      } catch { /* a dropped probe says nothing */ }
      if (verdict === 'ok') ok.push(model);
      else if (verdict === 'blocked') blocked[model] = reason;
      // Unknown keeps whatever the last check knew.
      else if (prev?.blocked[model]) blocked[model] = prev.blocked[model];
      else if (prev?.ok.includes(model)) ok.push(model);
    }
    writeAccess({ checkedAt: Date.now(), ok, blocked });
  })().catch((e) => { console.warn('[Ollama] account check failed:', (e as Error).message); })
    .finally(() => { running = null; });
  return running;
}
