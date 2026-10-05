// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PROJECT_ROOT } from '../config.js';

/**
 * Runtime health: surfaces the Claude Code version that the bundled SDK
 * actually launches, vs the system Claude Code. The bundled runtime is
 * the one that matters for model compatibility — `@anthropic-ai/claude-agent-sdk`
 * ships its own `cli.js` and uses it by default.
 *
 * The "active vs installed" distinction is load-bearing: after `npm install`
 * rewrites node_modules, the on-disk SDK reports a new version but the
 * running backend Node process still has the old SDK loaded in memory.
 * Active is captured once at module load (frozen until restart); installed
 * is read fresh from disk each call. The panel uses the diff between
 * them to surface "restart required" warnings.
 */

const SDK_PACKAGE_JSON_PATH = join(
  PROJECT_ROOT,
  'node_modules',
  '@anthropic-ai',
  'claude-agent-sdk',
  'package.json',
);

/**
 * Pure reader — exported for testability. The SDK's package.json exposes
 * `claudeCodeVersion` directly; we read the field rather than inferring
 * it from the SDK version.
 */
export function readClaudeCodeVersionFromSdk(
  path: string = SDK_PACKAGE_JSON_PATH,
): string | null {
  try {
    const pkg = JSON.parse(readFileSync(path, 'utf-8')) as {
      version?: string;
      claudeCodeVersion?: string;
    };
    return pkg.claudeCodeVersion ?? null;
  } catch {
    return null;
  }
}

// Captured once at module load — represents what the running process
// actually has in memory. Will stay frozen until backend restart.
const ACTIVE_RUNTIME = readClaudeCodeVersionFromSdk();

/** Returns the Claude Code version the running backend has loaded. */
export function getActiveRuntimeVersion(): string | null {
  return ACTIVE_RUNTIME;
}

/**
 * Returns the Claude Code version currently on disk (in node_modules).
 * After an `npm install`, this reflects the new on-disk version while
 * the active cache continues to report the version the running process
 * loaded at startup.
 */
export function getInstalledRuntimeVersion(): string | null {
  return readClaudeCodeVersionFromSdk();
}

/**
 * Shell out to `claude --version`. Strictly informational — Aerie does
 * NOT use the system Claude Code; the backend launches the SDK's bundled
 * cli.js. Returns null when the command is unavailable.
 */
export function getSystemClaudeCodeVersion(): string | null {
  const cmd = process.platform === 'win32' ? 'claude.cmd' : 'claude';
  try {
    const out = execFileSync(cmd, ['--version'], {
      encoding: 'utf-8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const match = out.match(/(\d+\.\d+\.\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Compare two MAJOR.MINOR.PATCH version strings numerically per component.
 * Returns -1 if a < b, 0 if equal, 1 if a > b.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

export interface RuntimeHealth {
  activeRuntimeVersion: string | null;
  installedRuntimeVersion: string | null;
  systemCcVersion: string | null;
  restartRequired: boolean;
}

/**
 * One-shot snapshot of runtime state for the health endpoint. Computes
 * `restartRequired` from the active-vs-installed diff (panel surfaces
 * this as "restart to load the new runtime").
 */
export function getRuntimeHealth(): RuntimeHealth {
  const active = getActiveRuntimeVersion();
  const installed = getInstalledRuntimeVersion();
  const system = getSystemClaudeCodeVersion();
  const restartRequired = !!(
    active && installed && compareVersions(installed, active) > 0
  );
  return {
    activeRuntimeVersion: active,
    installedRuntimeVersion: installed,
    systemCcVersion: system,
    restartRequired,
  };
}
