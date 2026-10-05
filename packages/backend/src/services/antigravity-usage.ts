// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// The third meter — Antigravity's model quota.
//
// The CLI has a usage command, and the reason it had been missed is worth
// writing down, because it is a search failure rather than a missing
// feature. `agy --help` lists SUBCOMMANDS; /usage is a SLASH COMMAND,
// a separate namespace the help text only hints at via --disable-slash-commands.
// A grep of the binary for the string "/usage" finds nothing, because the CLI
// stores the bare name and puts the slash on at render.
//
// It runs headless and costs nothing — no model turn, exit 0 — which makes this
// the same shape as the Codex reader rather than the Claude one: ask the tool
// what it already knows instead of asking the provider ourselves.
//
// The CLI prints one tab-separated row per limit:
//   Gemini Models\tWeekly Limit Remaining\t100%\t2026-09-20T19:41:19Z
// Group, limit name, percent REMAINING, and when it resets.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';

const run = promisify(execFile);
const DEFAULT_BIN = path.join(os.homedir(), '.local', 'bin', 'agy');
const CACHE_MS = 60_000;
// It answers in under a second when it answers at all; anything longer is a
// login prompt or a hang, and a meter is never worth blocking on.
const TIMEOUT_MS = 20_000;

export interface AntigravityLimit {
  group: string;
  label: string;
  /** Percent REMAINING, as the CLI reports it. */
  remainingPercent: number;
  resetsAt: string | null;
}

export interface AntigravityUsage {
  limits: AntigravityLimit[];
  readAt: string;
}

/**
 * Parse the CLI's tab-separated output.
 *
 * Deliberately forgiving about everything except the number: a row it cannot
 * read is DROPPED rather than guessed at, because a meter that invents a
 * figure is worse than a meter with a gap in it.
 */
export function parseUsage(stdout: string): AntigravityLimit[] {
  const out: AntigravityLimit[] = [];
  for (const line of stdout.split('\n')) {
    const cells = line.split('\t').map((c) => c.trim()).filter((c) => c.length);
    if (cells.length < 3) continue;
    const [group, label, percentCell, resetCell] = cells;
    const match = /^(\d+(?:\.\d+)?)\s*%$/.exec(percentCell);
    if (!match) continue;
    const remainingPercent = Number.parseFloat(match[1]);
    if (!Number.isFinite(remainingPercent)) continue;
    out.push({
      group,
      label,
      remainingPercent,
      resetsAt: resetCell && !Number.isNaN(Date.parse(resetCell)) ? resetCell : null,
    });
  }
  return out;
}

let cache: { at: number; value: AntigravityUsage } | null = null;

export async function getAntigravityUsage(bin = DEFAULT_BIN): Promise<AntigravityUsage> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const { stdout } = await run(bin, ['--print', '/usage', '--output-format', 'text'], {
    timeout: TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
  });
  const limits = parseUsage(stdout);
  if (!limits.length) {
    throw new Error('Antigravity answered, but no quota lines could be read from it');
  }
  const value: AntigravityUsage = { limits, readAt: new Date().toISOString() };
  cache = { at: Date.now(), value };
  return value;
}
