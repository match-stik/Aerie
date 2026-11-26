// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
/**
 * Which Antigravity models can paint, read off the signed-in account with
 * `agy models` instead of typed out by hand (asked for Nov 26 2026, the morning
 * that command listed Gemini 4 Hydrogen and Studio had never heard of it).
 *
 * Only Gemini rows are kept: Claude and GPT-OSS answer in Antigravity too, but
 * they have no image tool. The names are the display names agy prints, the same
 * form --model has always been given here. A read happens at most once an hour;
 * the last good list is kept in the config store so a restart has it, and
 * ANTIGRAVITY_MODELS stands in when there has never been one.
 */
import { spawn } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';
import { getConfig, setConfig } from '../db/config.js';
import { ANTIGRAVITY_MODELS, antigravityBin } from './settings.js';

const CACHE_KEY = 'image_gen.antigravity_models_cache';
const FRESH_MS = 60 * 60 * 1000;
let lastReadAt = 0;

/** `agy models` output (id, a tab, the display name) turned into the painter names. */
export function parseAgyModels(stdout: string): string[] {
  const names: string[] = [];
  for (const line of stdout.split('\n')) {
    const [id, name] = line.split('\t').map((part) => part?.trim());
    if (!id || !name || !id.startsWith('gemini-')) continue;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/** The painters to offer and accept: the last read of the account, else the hand-typed list. */
export function knownAntigravityModels(): string[] {
  try {
    const cached = JSON.parse(getConfig(CACHE_KEY) || '[]');
    if (Array.isArray(cached) && cached.length > 0 && cached.every((n) => typeof n === 'string')) return cached;
  } catch { /* fall through */ }
  return [...ANTIGRAVITY_MODELS];
}

function runAgyModels(): Promise<string> {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      PATH: `${join(homedir(), '.local', 'bin')}:${process.env.PATH || ''}`,
      HOME: process.env.HOME || homedir(),
    };
    const child = spawn(antigravityBin(), ['models'], { env, cwd: '/tmp', stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } reject(new Error('agy models timed out')); }, 30_000);
    child.stdout.on('data', (chunk) => { out += String(chunk); });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(`agy models exited ${code}`)); });
  });
}

/** Read the account's painters if the last read is over an hour old, and hand back what is known. */
export async function refreshAntigravityModels(
  read: () => Promise<string> = runAgyModels,
  now = Date.now(),
): Promise<string[]> {
  if (lastReadAt && now - lastReadAt < FRESH_MS) return knownAntigravityModels();
  lastReadAt = now;
  try {
    const names = parseAgyModels(await read());
    if (names.length > 0) setConfig(CACHE_KEY, JSON.stringify(names));
  } catch { /* keep the last good list */ }
  return knownAntigravityModels();
}

/** For tests: let the next refresh read again. */
export function resetAntigravityModelRead(): void {
  lastReadAt = 0;
}
