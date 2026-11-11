// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Updating Claude Code from Settings, and rolling it back (theirs, Nov 10 2026:
// 'make it a narrow button'; the idea is Maggie's, from
// her Covenant V3, which updates the copy inside its project).
//
// Our lanes run the Claude Code installed for the whole box, which belongs to
// root, and since Sep 30 2026 the house account cannot become root. So the
// house never gets root back: tools/claude-code-updater/install.sh, run once by
// them with sudo, puts one root-owned script in /usr/local/sbin that installs a
// given Claude Code version and nothing else, and lets this account run only
// that file. A lane talked into pressing the button could at most install a
// real Anthropic release, which is what the button is for.
//
// The new version reaches each lane on its next start, which is their restart.

import { spawn, spawnSync } from 'child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { PROJECT_ROOT } from '../config.js';
import { installedClaudeProgram } from './claude-model-check.js';

export const UPDATER = '/usr/local/sbin/aerie-update-claude-code';
const LATEST_URL = 'https://registry.npmjs.org/@anthropic-ai/claude-code/latest';
const LATEST_TTL_MS = 60 * 60 * 1000;
const STATE_FILE = join(PROJECT_ROOT, 'data', 'claude-code-update.json');
/** An install still marked running after this long died with the backend. */
const RUN_LIMIT_MS = 15 * 60 * 1000;

export const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,6}$/;

/** Numeric MAJOR.MINOR.PATCH order: '2.1.98' is older than '2.1.111'. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

export interface UpdateState {
  state: 'running' | 'done' | 'failed';
  action: 'update' | 'rollback';
  from: string | null;
  to: string;
  startedAt: string;
  finishedAt?: string;
  /** The last lines npm printed, when it failed. */
  detail?: string;
}

export function readState(): UpdateState | null {
  try {
    const s = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as UpdateState;
    if (s.state === 'running' && Date.now() - Date.parse(s.startedAt) > RUN_LIMIT_MS) {
      return { ...s, state: 'failed', detail: 'The install never reported back; the house may have restarted during it.' };
    }
    return s;
  } catch {
    return null;
  }
}

function writeState(s: UpdateState): void {
  const tmp = `${STATE_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2));
  renameSync(tmp, STATE_FILE);
}

/** The version on disk now, read from the installed package. */
export function installedVersion(): string | null {
  const program = installedClaudeProgram();
  if (!program) return null;
  for (const pkg of [join(dirname(program), '..', 'package.json'), join(dirname(program), 'package.json')]) {
    try {
      const v = JSON.parse(readFileSync(pkg, 'utf8')).version;
      if (typeof v === 'string' && VERSION_RE.test(v)) return v;
    } catch { /* try the next */ }
  }
  return null;
}

let latestCache: { at: number; version: string } | null = null;

export async function latestVersion(): Promise<string | null> {
  if (latestCache && Date.now() - latestCache.at < LATEST_TTL_MS) return latestCache.version;
  try {
    const res = await fetch(LATEST_URL, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const v = (await res.json() as { version?: unknown }).version;
    if (typeof v !== 'string' || !VERSION_RE.test(v)) return null;
    latestCache = { at: Date.now(), version: v };
    return v;
  } catch {
    return null;
  }
}

/** Whether their one-time setup is in place: sudo really runs the updater for
 *  this account with no password. `sudo -n -l` is not enough, because it
 *  reports a command as allowed even when a later rule puts a password on it
 *  (Nov 10 2026). So run it with no version: the updater refuses that with 2,
 *  and sudo answers 1 when it wants a password. */
export function updaterReady(): boolean {
  if (!existsSync(UPDATER)) return false;
  const check = spawnSync('sudo', ['-n', UPDATER], { stdio: 'ignore', timeout: 5000 });
  return check.status === 2;
}

export class UpdateRefused extends Error {}

/** Start one install; it runs on after this returns and records its outcome. */
export function startInstall(version: string, action: 'update' | 'rollback'): UpdateState {
  if (!VERSION_RE.test(version)) throw new UpdateRefused('That is not a version number.');
  const current = readState();
  if (current?.state === 'running') throw new UpdateRefused('An install is already running.');
  if (!updaterReady()) throw new UpdateRefused('The one-time setup has not been run on the box yet.');
  const from = installedVersion();
  const state: UpdateState = { state: 'running', action, from, to: version, startedAt: new Date().toISOString() };
  writeState(state);
  const child = spawn('sudo', ['-n', UPDATER, version], { stdio: ['ignore', 'pipe', 'pipe'] });
  let tail = '';
  const keep = (b: Buffer) => { tail = (tail + b.toString()).slice(-1500); };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  child.on('error', (err) => {
    writeState({ ...state, state: 'failed', finishedAt: new Date().toISOString(), detail: err.message });
  });
  child.on('close', (code) => {
    const now = installedVersion();
    const ok = code === 0 && now === version;
    writeState({
      ...state,
      state: ok ? 'done' : 'failed',
      finishedAt: new Date().toISOString(),
      ...(ok ? {} : { detail: tail.trim().split('\n').slice(-6).join('\n') || `npm ended with ${code}` }),
    });
  });
  return state;
}
