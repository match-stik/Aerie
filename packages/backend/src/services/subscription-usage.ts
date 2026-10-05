// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * Claude + Codex subscription usage — the two meters the house couldn't
 * read until Jul 22, 2026. Both are borrowed read-only views:
 *
 * - Claude: the same OAuth usage endpoint the Claude CLI polls for its own
 *   /usage screen, using the access token already on disk. Never touches
 *   the refresh token — the CLI owns that lifecycle.
 * - Codex: the daemon stamps rate-limit state into every session
 *   transcript's token_count events. Reading the freshest stamp costs
 *   nothing and refreshes every sweep.
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CLAUDE_CREDENTIALS_PATH = path.join(os.homedir(), '.claude', '.credentials.json');
const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const CLAUDE_TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
// Public OAuth client identifier used by Claude Code itself. This is not a
// secret; the rotating refresh token remains only in ~/.claude.
const CLAUDE_CODE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const CODEX_SESSIONS_DIR = path.join(os.homedir(), '.codex', 'sessions');
const USAGE_CACHE_MS = 60_000;
// How many of the newest transcripts to scan before concluding there is no
// rate-limit stamp — a just-started session may not have one yet.
const CODEX_SCAN_FILES = 10;

export interface ClaudeLimit {
  kind: string;
  label: string;
  percent: number;
  severity: string;
  resetsAt: string | null;
  isActive: boolean;
}

export interface ClaudeExtraUsage {
  enabled: boolean;
  utilization: number | null;
  monthlyLimit: number | null;
  usedCredits: number | null;
  disabledReason: string | null;
}

export interface ClaudeSpend {
  usedFormatted: string | null;
  limitFormatted: string | null;
  percent: number | null;
  enabled: boolean;
  canPurchaseCredits: boolean;
}

export interface ClaudeUsage {
  fiveHourPercent: number;
  fiveHourResetsAt: string | null;
  weeklyPercent: number;
  weeklyResetsAt: string | null;
  modelWeeklyPercent: number | null;
  modelWeeklyLabel: string | null;
  modelWeeklyResetsAt: string | null;
  extraUsageEnabled: boolean;
  subscriptionType: string;
  limits: ClaudeLimit[];
  extraUsage: ClaudeExtraUsage;
  spend: ClaudeSpend | null;
}

export interface CodexWindow {
  usedPercent: number;
  windowMinutes: number | null;
  resetsAt: string | null;
}

export interface CodexUsage {
  usedPercent: number;
  windowMinutes: number | null;
  resetsAt: string | null;
  planType: string;
  capturedAt: string | null;
  secondary: CodexWindow | null;
  creditsBalance: string | null;
  creditsUnlimited: boolean;
  hasCredits: boolean;
  limitReached: string | null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** "$0.00" from the API's { amount_minor, currency, exponent } money shape. */
function formatMinorAmount(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const money = value as Record<string, unknown>;
  const minor = num(money.amount_minor);
  if (minor === null) return null;
  const exponent = num(money.exponent) ?? 2;
  const currency = typeof money.currency === 'string' ? money.currency : 'USD';
  const amount = minor / 10 ** exponent;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount.toFixed(exponent)} ${currency}`;
  }
}

function limitLabel(kind: string, scope: Record<string, unknown>): string {
  if (kind === 'session') return '5-hour window';
  const model = (scope.model ?? {}) as Record<string, unknown>;
  const scopeName =
    typeof model.display_name === 'string'
      ? model.display_name
      : typeof scope.surface === 'string'
        ? scope.surface
        : null;
  if (kind === 'weekly_all') return 'weekly · all models';
  if (kind === 'weekly_scoped') return `weekly · ${scopeName ?? 'scoped'}`;
  const base = kind.replace(/_/g, ' ');
  return scopeName ? `${base} · ${scopeName}` : base;
}

export function parseClaudeUsage(
  raw: Record<string, unknown>,
  subscriptionType: string,
): ClaudeUsage {
  const fiveHour = (raw.five_hour ?? {}) as Record<string, unknown>;
  const sevenDay = (raw.seven_day ?? {}) as Record<string, unknown>;
  const extra = (raw.extra_usage ?? {}) as Record<string, unknown>;

  // Every limit the endpoint reports, passed through generically — new
  // scoped model windows show up on the card without a code change.
  const limits: ClaudeLimit[] = [];
  let modelWeeklyPercent: number | null = null;
  let modelWeeklyLabel: string | null = null;
  let modelWeeklyResetsAt: string | null = null;
  if (Array.isArray(raw.limits)) {
    for (const entry of raw.limits) {
      if (!entry || typeof entry !== 'object') continue;
      const limit = entry as Record<string, unknown>;
      const kind = typeof limit.kind === 'string' ? limit.kind : null;
      const percent = num(limit.percent);
      if (kind === null || percent === null) continue;
      const scope = (limit.scope ?? {}) as Record<string, unknown>;
      limits.push({
        kind,
        label: limitLabel(kind, scope),
        percent,
        severity: typeof limit.severity === 'string' ? limit.severity : 'normal',
        resetsAt: isoOrNull(limit.resets_at),
        isActive: limit.is_active === true,
      });
      if (kind === 'weekly_scoped' && modelWeeklyPercent === null) {
        const model = (scope.model ?? {}) as Record<string, unknown>;
        modelWeeklyPercent = percent;
        modelWeeklyLabel = typeof model.display_name === 'string' ? model.display_name : null;
        modelWeeklyResetsAt = isoOrNull(limit.resets_at);
      }
    }
  }

  const spendRaw = raw.spend as Record<string, unknown> | undefined;
  const spend: ClaudeSpend | null =
    spendRaw && typeof spendRaw === 'object'
      ? {
          usedFormatted: formatMinorAmount(spendRaw.used),
          limitFormatted: formatMinorAmount(spendRaw.limit),
          percent: num(spendRaw.percent),
          enabled: spendRaw.enabled === true,
          canPurchaseCredits: spendRaw.can_purchase_credits === true,
        }
      : null;

  return {
    fiveHourPercent: num(fiveHour.utilization) ?? 0,
    fiveHourResetsAt: isoOrNull(fiveHour.resets_at),
    weeklyPercent: num(sevenDay.utilization) ?? 0,
    weeklyResetsAt: isoOrNull(sevenDay.resets_at),
    modelWeeklyPercent,
    modelWeeklyLabel,
    modelWeeklyResetsAt,
    extraUsageEnabled: extra.is_enabled === true,
    subscriptionType,
    limits,
    extraUsage: {
      enabled: extra.is_enabled === true,
      utilization: num(extra.utilization),
      monthlyLimit: num(extra.monthly_limit),
      usedCredits: num(extra.used_credits),
      disabledReason: typeof extra.disabled_reason === 'string' ? extra.disabled_reason : null,
    },
    spend,
  };
}

/**
 * Pull the rate-limit stamp out of one parsed transcript line, or null if
 * the line isn't a token_count event carrying one.
 */
function parseCodexWindow(value: unknown): CodexWindow | null {
  if (!value || typeof value !== 'object') return null;
  const window = value as Record<string, unknown>;
  const usedPercent = num(window.used_percent);
  if (usedPercent === null) return null;
  const resetsUnix = num(window.resets_at);
  return {
    usedPercent,
    windowMinutes: num(window.window_minutes),
    resetsAt: resetsUnix ? new Date(resetsUnix * 1000).toISOString() : null,
  };
}

export function parseCodexTokenCountLine(line: Record<string, unknown>): CodexUsage | null {
  const payload = (line.payload ?? {}) as Record<string, unknown>;
  if (payload.type !== 'token_count') return null;
  const rateLimits = payload.rate_limits as Record<string, unknown> | undefined;
  if (!rateLimits || typeof rateLimits !== 'object') return null;
  const primary = parseCodexWindow(rateLimits.primary);
  if (!primary) return null;
  const credits = (rateLimits.credits ?? {}) as Record<string, unknown>;
  return {
    usedPercent: primary.usedPercent,
    windowMinutes: primary.windowMinutes,
    resetsAt: primary.resetsAt,
    planType: typeof rateLimits.plan_type === 'string' ? rateLimits.plan_type : 'unknown',
    capturedAt: isoOrNull(line.timestamp),
    secondary: parseCodexWindow(rateLimits.secondary),
    creditsBalance: typeof credits.balance === 'string' ? credits.balance : null,
    creditsUnlimited: credits.unlimited === true,
    hasCredits: credits.has_credits === true,
    limitReached:
      typeof rateLimits.rate_limit_reached_type === 'string'
        ? rateLimits.rate_limit_reached_type
        : null,
  };
}

interface ClaudeCredentials {
  accessToken: string;
  refreshToken: string | null;
  subscriptionType: string;
}

async function readClaudeCredentials(): Promise<ClaudeCredentials> {
  const raw = JSON.parse(await fs.readFile(CLAUDE_CREDENTIALS_PATH, 'utf8')) as {
    claudeAiOauth?: {
      accessToken?: unknown;
      refreshToken?: unknown;
      subscriptionType?: unknown;
    };
  };
  const oauth = raw.claudeAiOauth;
  if (!oauth || typeof oauth.accessToken !== 'string' || !oauth.accessToken) {
    throw new Error('No Claude OAuth token on disk');
  }
  return {
    accessToken: oauth.accessToken,
    refreshToken: typeof oauth.refreshToken === 'string' && oauth.refreshToken
      ? oauth.refreshToken
      : null,
    subscriptionType: typeof oauth.subscriptionType === 'string' ? oauth.subscriptionType : 'unknown',
  };
}

let claudeCache: { at: number; data: ClaudeUsage } | null = null;
let claudeRefreshPromise: Promise<ClaudeCredentials> | null = null;

async function fetchClaudeUsage(creds: ClaudeCredentials): Promise<Response> {
  return fetch(CLAUDE_USAGE_URL, {
    headers: {
      Authorization: `Bearer ${creds.accessToken}`,
      'anthropic-beta': 'oauth-2025-04-20',
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Refresh the same OAuth credential Claude Code owns, preserving every
 * CLI-specific field in its file. A single in-process promise prevents the
 * usage card's concurrent mounts from rotating the token twice.
 */
async function refreshClaudeCredentials(stale: ClaudeCredentials): Promise<ClaudeCredentials> {
  if (claudeRefreshPromise) return claudeRefreshPromise;
  claudeRefreshPromise = (async () => {
    // Claude Code may have refreshed between our failed request and this
    // retry. Prefer its newer token instead of rotating again.
    const current = await readClaudeCredentials();
    if (current.accessToken !== stale.accessToken) return current;
    if (!current.refreshToken) throw new Error('Claude OAuth token expired and no refresh token is available');

    const res = await fetch(CLAUDE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: current.refreshToken,
        client_id: CLAUDE_CODE_CLIENT_ID,
      }),
    });
    if (!res.ok) {
      throw new Error(`Claude OAuth refresh answered ${res.status}`);
    }
    const refreshed = await res.json() as {
      access_token?: unknown;
      refresh_token?: unknown;
      expires_in?: unknown;
      refresh_token_expires_in?: unknown;
      scope?: unknown;
    };
    if (
      typeof refreshed.access_token !== 'string'
      || !refreshed.access_token
      || typeof refreshed.refresh_token !== 'string'
      || !refreshed.refresh_token
    ) {
      throw new Error('Claude OAuth refresh returned incomplete credentials');
    }

    const raw = JSON.parse(await fs.readFile(CLAUDE_CREDENTIALS_PATH, 'utf8')) as {
      claudeAiOauth?: Record<string, unknown>;
    };
    const oauth = raw.claudeAiOauth;
    if (!oauth) throw new Error('Claude credential file changed during refresh');
    // If Claude Code won a refresh race, keep the credential it wrote.
    if (oauth.refreshToken !== current.refreshToken) return readClaudeCredentials();

    const now = Date.now();
    oauth.accessToken = refreshed.access_token;
    oauth.refreshToken = refreshed.refresh_token;
    if (typeof refreshed.expires_in === 'number') {
      oauth.expiresAt = now + refreshed.expires_in * 1000;
    }
    if (typeof refreshed.refresh_token_expires_in === 'number') {
      oauth.refreshTokenExpiresAt = now + refreshed.refresh_token_expires_in * 1000;
    }
    if (typeof refreshed.scope === 'string') {
      oauth.scopes = refreshed.scope.split(/\s+/).filter(Boolean);
    }

    const tempPath = `${CLAUDE_CREDENTIALS_PATH}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(raw), { mode: 0o600 });
    try {
      await fs.rename(tempPath, CLAUDE_CREDENTIALS_PATH);
    } catch (error) {
      await fs.unlink(tempPath).catch(() => undefined);
      throw error;
    }
    return readClaudeCredentials();
  })();
  try {
    return await claudeRefreshPromise;
  } finally {
    claudeRefreshPromise = null;
  }
}

export async function getClaudeUsage(): Promise<ClaudeUsage> {
  if (claudeCache && Date.now() - claudeCache.at < USAGE_CACHE_MS) {
    return claudeCache.data;
  }
  let creds = await readClaudeCredentials();
  let res = await fetchClaudeUsage(creds);
  if (res.status === 401) {
    creds = await refreshClaudeCredentials(creds);
    res = await fetchClaudeUsage(creds);
  }
  if (!res.ok) {
    throw new Error(`Claude usage endpoint answered ${res.status}`);
  }
  const data = parseClaudeUsage(
    (await res.json()) as Record<string, unknown>,
    creds.subscriptionType,
  );
  claudeCache = { at: Date.now(), data };
  return data;
}

/** Newest-first transcript paths, bounded — sessions nest as YYYY/MM/DD/. */
async function newestCodexTranscripts(limit: number): Promise<string[]> {
  const files: { path: string; mtimeMs: number }[] = [];
  let dayDirs: string[] = [];
  try {
    const years = (await fs.readdir(CODEX_SESSIONS_DIR)).sort().reverse().slice(0, 2);
    for (const year of years) {
      const yearDir = path.join(CODEX_SESSIONS_DIR, year);
      const months = (await fs.readdir(yearDir)).sort().reverse().slice(0, 2);
      for (const month of months) {
        const monthDir = path.join(yearDir, month);
        const days = (await fs.readdir(monthDir)).sort().reverse().slice(0, 7);
        dayDirs.push(...days.map((day) => path.join(monthDir, day)));
      }
    }
  } catch {
    return [];
  }
  dayDirs = dayDirs.slice(0, 7);
  for (const dayDir of dayDirs) {
    let names: string[] = [];
    try {
      names = await fs.readdir(dayDir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue;
      const filePath = path.join(dayDir, name);
      try {
        files.push({ path: filePath, mtimeMs: (await fs.stat(filePath)).mtimeMs });
      } catch {
        // File vanished mid-scan; skip it.
      }
    }
  }
  return files.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, limit).map((f) => f.path);
}

let codexCache: { at: number; data: CodexUsage } | null = null;

export async function getCodexUsage(): Promise<CodexUsage> {
  if (codexCache && Date.now() - codexCache.at < USAGE_CACHE_MS) {
    return codexCache.data;
  }
  for (const filePath of await newestCodexTranscripts(CODEX_SCAN_FILES)) {
    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch {
      continue;
    }
    // Last stamp in the file is the freshest; walk backwards.
    const lines = content.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line || !line.includes('rate_limits')) continue;
      try {
        const usage = parseCodexTokenCountLine(JSON.parse(line) as Record<string, unknown>);
        if (usage) {
          codexCache = { at: Date.now(), data: usage };
          return usage;
        }
      } catch {
        // Torn line from an in-flight write; keep walking.
      }
    }
  }
  throw new Error('No Codex rate-limit stamp found in recent sessions');
}
