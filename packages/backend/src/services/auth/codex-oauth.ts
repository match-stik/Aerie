// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Portions derive from Covenant (Maggie) — the Codex device-auth route — see NOTICE.
/**
 * Codex (ChatGPT) OAuth service — credentials persistence + login orchestration.
 *
 * This module is the only place that touches `codex-auth.json` on disk. All
 * other code goes through {@link getCodexAccessToken} or {@link getCodexAuthSnapshot}.
 *
 * It also owns the in-flight login session. Because the pi-ai
 * `loginOpenAICodex` promise can take minutes (it spins up a local HTTP
 * server on port 1455 to receive the browser callback), the HTTP route that
 * starts login MUST NOT await it. Instead, we kick the promise off in the
 * background, expose `getLoginSession()` for the route to poll, and let the
 * frontend poll `/api/auth/codex/status` until the session resolves.
 */

import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  loginOpenAICodex,
  refreshOpenAICodexToken,
  type OAuthCredentials,
} from '@earendil-works/pi-ai/oauth';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');

/** Refresh threshold: refresh if the access token expires within this many ms. */
const REFRESH_LEADTIME_MS = 5 * 60_000;

/** Stale-login GC: a login session older than this is considered abandoned. */
const LOGIN_TIMEOUT_MS = 10 * 60_000;

export type CodexLoginStatus =
  | 'idle'
  | 'awaiting_browser'
  | 'complete'
  | 'failed'
  | 'cancelled';

export interface CodexLoginSnapshot {
  status: CodexLoginStatus;
  url?: string;
  error?: string;
  startedAt?: number;
}

export interface CodexAuthSnapshot {
  loggedIn: boolean;
  expiresAt: number | null;
  refreshable: boolean;
  authPath: string;
  loginSession: CodexLoginSnapshot;
}

/** Thrown when a caller needs a token but auth is missing / unrecoverable. */
export class CodexAuthRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CodexAuthRequiredError';
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Path resolution
// ─────────────────────────────────────────────────────────────────────────

/**
 * Auth file lives next to the SQLite db by default (`./data/codex-auth.json`
 * under PROJECT_ROOT), matching the existing data dir convention. Override
 * with `CODEX_AUTH_PATH` for tests or non-default deployments.
 */
export function getCodexAuthPath(): string {
  if (process.env.CODEX_AUTH_PATH) {
    return resolve(process.env.CODEX_AUTH_PATH);
  }
  return resolve(PROJECT_ROOT, 'data', 'codex-auth.json');
}

// ─────────────────────────────────────────────────────────────────────────
// Persistence
// ─────────────────────────────────────────────────────────────────────────

async function readCredentials(): Promise<OAuthCredentials | null> {
  const path = getCodexAuthPath();
  if (!existsSync(path)) return null;
  try {
    const raw = await fs.readFile(path, 'utf8');
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.refresh === 'string' &&
      typeof parsed?.access === 'string' &&
      typeof parsed?.expires === 'number'
    ) {
      return parsed as OAuthCredentials;
    }
    console.warn('[CodexAuth] Auth file present but malformed; treating as logged out');
    return null;
  } catch (err) {
    console.warn('[CodexAuth] Failed to read auth file:', err);
    return null;
  }
}

/**
 * Where the Codex CLI keeps its own grant. `codex login` writes this, and the
 * CLI refreshes it every time that lane is used.
 */
export function getCodexCliAuthPath(): string {
  if (process.env.CODEX_CLI_AUTH_PATH) {
    return resolve(process.env.CODEX_CLI_AUTH_PATH);
  }
  return resolve(homedir(), '.codex', 'auth.json');
}

/** Decode a JWT's `exp` claim into epoch ms. Null when it isn't readable. */
function jwtExpiryMs(token: string): number | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const exp = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))?.exp;
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * Borrow the Codex CLI's credentials when our own are absent or lapsed.
 *
 * The backend holds a separate OAuth grant from the CLI — same account, own
 * file, own schema — so a house that has run `codex login` over SSH can end up
 * with a live CLI token beside a long-dead backend one. Rather than making the
 * owner authenticate twice for the same account, read the CLI's.
 *
 * Read-only, deliberately. We never write this file and never spend its
 * refresh token: the provider rotates refresh tokens, so consuming it here
 * would invalidate the CLI's copy and break that lane on its next refresh.
 * The trade is that we can only borrow while the access token is genuinely
 * live — which it is, for as long as the CLI lane is in regular use.
 */
async function readCliCredentials(): Promise<OAuthCredentials | null> {
  const path = getCodexCliAuthPath();
  if (!existsSync(path)) return null;
  try {
    const tokens = JSON.parse(await fs.readFile(path, 'utf8'))?.tokens;
    const access = tokens?.access_token;
    if (typeof access !== 'string') return null;
    const expires = jwtExpiryMs(access);
    if (expires === null || expires - Date.now() <= REFRESH_LEADTIME_MS) return null;
    return {
      access,
      refresh: typeof tokens.refresh_token === 'string' ? tokens.refresh_token : '',
      expires,
      accountId: typeof tokens.account_id === 'string' ? tokens.account_id : undefined,
    } as OAuthCredentials;
  } catch (err) {
    console.warn('[CodexAuth] Failed to read Codex CLI auth file:', err);
    return null;
  }
}

async function writeCredentials(creds: OAuthCredentials): Promise<void> {
  const path = getCodexAuthPath();
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, JSON.stringify(creds, null, 2), { encoding: 'utf8' });
  // Best-effort 0600. No-op on Windows (NTFS ACLs differ); we don't error
  // because the alternative is forcing all Windows users to manage ACLs by
  // hand, which is hostile for a hobby-deployment app.
  try {
    await fs.chmod(path, 0o600);
  } catch {
    /* ignore — Windows */
  }
}

async function deleteCredentialsFile(): Promise<void> {
  const path = getCodexAuthPath();
  if (existsSync(path)) {
    await fs.unlink(path);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Refresh (with mutex)
// ─────────────────────────────────────────────────────────────────────────

let refreshInFlight: Promise<OAuthCredentials | null> | null = null;

/**
 * Refresh the access token using the stored refresh token. Returns the new
 * credentials (already persisted) or null if refresh failed.
 *
 * Mutexed: simultaneous callers share one in-flight refresh. Without this,
 * two concurrent turns can each detect "token expiring" and each fire a
 * refresh — the second receives a "refresh token already used" error from
 * OpenAI and incorrectly concludes auth is broken.
 */
async function refreshCredentials(current: OAuthCredentials): Promise<OAuthCredentials | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const refreshed = await refreshOpenAICodexToken(current.refresh);
      await writeCredentials(refreshed);
      console.log('[CodexAuth] Token refreshed; new expiry', new Date(refreshed.expires).toISOString());
      return refreshed;
    } catch (err) {
      console.warn('[CodexAuth] Token refresh failed:', err);
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

// ─────────────────────────────────────────────────────────────────────────
// Public API — credentials
// ─────────────────────────────────────────────────────────────────────────

/**
 * Get credentials, refreshing if the access token is within
 * REFRESH_LEADTIME_MS of expiry. Returns null if not logged in OR if refresh
 * failed (caller should treat both as "needs auth").
 */
export async function getCodexCredentials(): Promise<OAuthCredentials | null> {
  const current = await readCredentials();
  if (current && current.expires - Date.now() > REFRESH_LEADTIME_MS) {
    return current;
  }

  // Ours is missing or lapsed. The CLI lane keeps its own grant fresh for the
  // same account, so borrow that before asking for a second login.
  const borrowed = await readCliCredentials();
  if (borrowed) return borrowed;

  if (!current) return null;

  // Either expired or close enough — refresh.
  return refreshCredentials(current);
}

/**
 * Convenience: get just the access token, throwing if auth is unavailable.
 * CodexRuntime will use this on every turn (PR E2). For status checks, use
 * {@link getCodexAuthSnapshot} instead — it never throws.
 */
export async function getCodexAccessToken(): Promise<string> {
  const creds = await getCodexCredentials();
  if (!creds) {
    throw new CodexAuthRequiredError(
      'Codex auth required. Log in via Settings → Provider Health.',
    );
  }
  return creds.access;
}

/**
 * Synchronous "is there an auth file at all" check, for warm-path display
 * code that wants to show a badge without doing I/O. Does NOT validate
 * expiry — use {@link getCodexAuthSnapshot} for that.
 */
export function isCodexLoggedIn(): boolean {
  return existsSync(getCodexAuthPath()) || existsSync(getCodexCliAuthPath());
}

/**
 * Non-throwing snapshot for the /status route. Reads the file fresh, returns
 * loggedIn=false on any failure rather than throwing.
 */
export async function getCodexAuthSnapshot(): Promise<CodexAuthSnapshot> {
  const own = await readCredentials();
  // Report what a turn would actually get. When our own grant has lapsed but
  // the CLI's is live we borrow it, so Provider Health should say connected
  // rather than sending the owner to log in for a lane that already works.
  const borrowed = own && own.expires - Date.now() > REFRESH_LEADTIME_MS ? null : await readCliCredentials();
  const creds = borrowed ?? own;
  return {
    loggedIn: !!creds,
    expiresAt: creds?.expires ?? null,
    refreshable: !!creds?.refresh,
    authPath: borrowed ? getCodexCliAuthPath() : getCodexAuthPath(),
    loginSession: getLoginSession(),
  };
}

/**
 * Logout: delete credentials, cancel any in-flight login. Idempotent.
 */
export async function logoutCodex(): Promise<void> {
  cancelLoginSession();
  await deleteCredentialsFile();
  console.log('[CodexAuth] Logged out (credentials deleted)');
}

// ─────────────────────────────────────────────────────────────────────────
// Login session (singleton)
// ─────────────────────────────────────────────────────────────────────────

interface ActiveLoginSession {
  status: CodexLoginStatus;
  url?: string;
  error?: string;
  startedAt: number;
  manualCodeResolver?: (code: string) => void;
  manualCodeRejecter?: (err: Error) => void;
  abortController: AbortController;
}

let activeLogin: ActiveLoginSession | null = null;

function gcStaleLogin(): void {
  if (!activeLogin) return;
  if (Date.now() - activeLogin.startedAt > LOGIN_TIMEOUT_MS) {
    console.warn('[CodexAuth] Stale login session (>10min); clearing');
    cancelLoginSession();
  }
}

export function getLoginSession(): CodexLoginSnapshot {
  gcStaleLogin();
  if (!activeLogin) return { status: 'idle' };
  return {
    status: activeLogin.status,
    url: activeLogin.url,
    error: activeLogin.error,
    startedAt: activeLogin.startedAt,
  };
}

/**
 * Begin the OAuth login flow. Returns once the browser URL is ready (or
 * after a short timeout if the flow fails immediately). The login promise
 * itself continues running in the background — poll {@link getLoginSession}
 * to detect completion or failure.
 *
 * Awaiting the returned promise does NOT mean login succeeded — it means
 * the URL is ready to hand to the browser. Caller should inspect the
 * returned snapshot's `status` and `url` fields.
 */
export async function startCodexLogin(): Promise<CodexLoginSnapshot> {
  // If a login is already in flight, return its current state instead of
  // racing two flows (which would both try to bind port 1455).
  if (activeLogin && (activeLogin.status === 'awaiting_browser')) {
    return getLoginSession();
  }
  // Stale terminal states get cleared on a fresh start.
  if (activeLogin && activeLogin.status !== 'awaiting_browser') {
    activeLogin = null;
  }

  let urlResolved: () => void = () => { /* assigned below */ };
  const urlReady = new Promise<void>((resolve) => { urlResolved = resolve; });

  const manualCodePromise = new Promise<string>((resolve, reject) => {
    // We'll wire the resolver into activeLogin below so the route can fire it.
    queueMicrotask(() => {
      if (activeLogin) {
        activeLogin.manualCodeResolver = resolve;
        activeLogin.manualCodeRejecter = reject;
      }
    });
  });

  activeLogin = {
    status: 'awaiting_browser',
    startedAt: Date.now(),
    abortController: new AbortController(),
  };

  // Kick off the OAuth flow. Do NOT await — it runs until the browser
  // callback hits OR the manual code resolves OR the user gives up.
  (async () => {
    const session = activeLogin;
    if (!session) return;
    try {
      const creds = await loginOpenAICodex({
        onAuth: ({ url }) => {
          session.url = url;
          urlResolved();
          console.log('[CodexAuth] OAuth URL ready:', url);
        },
        onPrompt: async () => {
          // We provide onManualCodeInput, so onPrompt is the no-browser
          // fallback path. pi-ai shouldn't call it when we've set up a
          // race, but stub it for safety.
          throw new Error(
            'Codex auth: interactive prompt is not supported in this transport',
          );
        },
        onManualCodeInput: () => manualCodePromise,
        onProgress: (msg) => console.log('[CodexAuth]', msg),
      });

      // Gate before writing: pi-ai's browser-callback path can still
      // resolve loginOpenAICodex even after we've rejected the
      // manual-code race in cancelLoginSession() — the two are
      // independent. If the session was cancelled (or superseded by a
      // newer login, or cleared by logoutCodex) while we were awaiting,
      // discard these credentials instead of recreating them. Otherwise
      // a late callback re-writes the file the user just removed,
      // violating logout's "deletes credentials" contract.
      if (activeLogin !== session || session.status !== 'awaiting_browser') {
        console.log(
          '[CodexAuth] Login resolved but session is no longer active (status:',
          session.status + ') — discarding credentials',
        );
        return;
      }
      await writeCredentials(creds);
      session.status = 'complete';
      console.log(
        '[CodexAuth] Login complete; access token expires',
        new Date(creds.expires).toISOString(),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // If we never resolved the URL (flow failed immediately), unblock the
      // route handler so it doesn't hang.
      urlResolved();
      // If this session was cancelled, the abort path already set status.
      if (session.status !== 'cancelled') {
        session.status = 'failed';
        session.error = message;
      }
      console.warn('[CodexAuth] Login failed:', message);
    }
  })();

  // Wait up to 5s for the URL to populate so the route can return it. If
  // the OAuth flow is broken at the network level, we return whatever state
  // we have rather than hanging the request.
  const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, 5000));
  await Promise.race([urlReady, timeoutPromise]);

  return getLoginSession();
}

/**
 * Resolve the manual-code paste promise. Returns true if there was an
 * active session waiting for it.
 */
export function submitManualCode(code: string): boolean {
  if (!activeLogin || activeLogin.status !== 'awaiting_browser') return false;
  if (!activeLogin.manualCodeResolver) return false;
  activeLogin.manualCodeResolver(code);
  return true;
}

/**
 * Cancel any in-flight login. Idempotent.
 */
export function cancelLoginSession(): void {
  if (!activeLogin) return;
  const session = activeLogin;
  session.status = 'cancelled';
  session.abortController.abort();
  // Reject the manual-code promise so the loginOpenAICodex await unblocks.
  session.manualCodeRejecter?.(new Error('Codex login cancelled'));
  activeLogin = null;
}

// Test seam: clear all module state. Only used by unit tests.
export function _resetForTests(): void {
  activeLogin = null;
  refreshInFlight = null;
}
