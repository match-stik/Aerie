// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Live MCP health for the warm CLI lanes.
//
// The backend never sees these connections: the CLI session loads its own
// servers, so `cachedMcpStatus` only ever holds what the enable/disable buttons
// wrote. For months `/mcp` answered from that and could only report
// configuration — which is why a Cortex connector sat unauthorized for weeks
// with nothing on any screen saying so.
//
// The CLI does know, and will say: `claude mcp list` health-checks every server
// and prints one line each. It costs about nine seconds because it genuinely
// reaches them — the owner's call was that they would rather wait and be told
// the truth than be answered instantly from a list nothing marks connected.
//
// It prints for a human and has no --json, so the parser below is the part that
// breaks when the CLI changes its format. It is pure and tested for that
// reason, and an unparseable line is KEPT as unknown rather than dropped: a
// server silently missing from this readout would be worse than an ugly one.

import { execFile } from 'child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { PROJECT_ROOT } from '../config.js';
import { projectKeyForDir } from './agent/session-list.js';

// ---------------------------------------------------------------------------
// Codex app-server inventory
// ---------------------------------------------------------------------------
//
// The Codex daemon owns its MCP connections and exposes their current catalog
// through `mcpServerStatus/list`. This is deliberately a different shape from
// the Claude CLI readers below: one row is one MCP server, while `codex_apps`
// is one server containing several app/connector families. Tool schemas are
// useful for naming those families, but never become the server count.

export type CodexMcpAuthStatus = 'unsupported' | 'notLoggedIn' | 'bearerToken' | 'oAuth';

export interface CodexMcpServerInfo {
  name: string;
  title?: string | null;
  version: string;
  description?: string | null;
  icons?: unknown[] | null;
  websiteUrl?: string | null;
}

export interface CodexMcpTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  annotations?: unknown;
  icons?: unknown[];
  _meta?: unknown;
}

export interface CodexMcpServerStatus {
  name: string;
  serverInfo: CodexMcpServerInfo | null;
  tools: Record<string, CodexMcpTool>;
  resources?: unknown[];
  resourceTemplates?: unknown[];
  authStatus: CodexMcpAuthStatus;
}

export interface CodexAppFamily {
  /** Stable fallback key taken from the tool namespace before its first dot. */
  key: string;
  /** Human name advertised in the tool's Codex Apps metadata. */
  name: string;
  toolCount: number;
}

export interface CodexMcpClassification {
  /** Initialized servers whose authentication state is usable now. */
  ready: CodexMcpServerStatus[];
  /** Servers whose catalog explicitly says a login is still required. */
  needsAuth: CodexMcpServerStatus[];
  /** Servers with no initialized serverInfo and no outstanding login. */
  unavailable: CodexMcpServerStatus[];
  /** Connector families nested inside the ONE `codex_apps` MCP server. */
  appFamilies: CodexAppFamily[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function humanizeCodexAppKey(key: string): string {
  return key
    .split(/[_-]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** Read the connector's own display name without assuming one fixed metadata
 *  revision. Current Codex Apps puts it directly under `_meta`; older cached
 *  schemas have also carried an `_codex_apps` object. */
function codexAppConnectorName(tool: CodexMcpTool): string | null {
  const meta = record(tool._meta);
  if (!meta) return null;
  if (typeof meta.connector_name === 'string' && meta.connector_name.trim()) {
    return meta.connector_name.trim();
  }
  const nested = record(meta._codex_apps);
  return typeof nested?.connector_name === 'string' && nested.connector_name.trim()
    ? nested.connector_name.trim()
    : null;
}

/** Group the tool catalog nested inside `codex_apps` into app families. The
 *  connector metadata supplies the human name; the namespace remains the
 *  stable fallback and prevents a missing label from dropping a family. */
export function codexAppFamilies(server: CodexMcpServerStatus | undefined): CodexAppFamily[] {
  if (!server || server.name !== 'codex_apps') return [];

  const families = new Map<string, CodexAppFamily>();
  for (const [registeredName, tool] of Object.entries(server.tools || {})) {
    const rawKey = registeredName.includes('.') ? registeredName.slice(0, registeredName.indexOf('.')) : registeredName;
    const key = rawKey || 'other';
    const advertisedName = codexAppConnectorName(tool);
    // A connector's own name is the best grouping key when present. The
    // namespace keeps two unlabelled families from collapsing into "Other".
    const groupKey = advertisedName ? `name:${advertisedName}` : `namespace:${key}`;
    const existing = families.get(groupKey);
    if (existing) {
      existing.toolCount++;
    } else {
      families.set(groupKey, {
        key,
        name: advertisedName || humanizeCodexAppKey(key),
        toolCount: 1,
      });
    }
  }

  return [...families.values()].sort((a, b) =>
    b.toolCount - a.toolCount || a.name.localeCompare(b.name));
}

/** Partition the daemon snapshot without turning tool schemas into servers.
 *  `notLoggedIn` gets its own lane even when the daemon retained a serverInfo;
 *  a null serverInfo with no auth request is the positive unavailable case. */
export function classifyCodexMcpStatus(servers: CodexMcpServerStatus[]): CodexMcpClassification {
  const needsAuth = servers.filter(server => server.authStatus === 'notLoggedIn');
  const ready = servers.filter(server => server.serverInfo !== null && server.authStatus !== 'notLoggedIn');
  const unavailable = servers.filter(server => server.serverInfo === null && server.authStatus !== 'notLoggedIn');
  const apps = servers.find(server => server.name === 'codex_apps');
  return { ready, needsAuth, unavailable, appFamilies: codexAppFamilies(apps) };
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm;
}

function codexServerLabel(server: CodexMcpServerStatus): string {
  return server.name === 'codex_apps' ? 'Codex Apps' : server.name;
}

/** Human readout for `/mcp`: server state first, app families nested under the
 *  single Codex Apps row. Counts beside families are advertised schemas, not a
 *  claim about the frozen tool registry of an already-warm model turn. */
export function summarizeCodexMcpStatus(servers: CodexMcpServerStatus[]): string {
  if (!servers.length) return 'No MCP servers reported by the Codex daemon.';
  const state = classifyCodexMcpStatus(servers);
  const parts: string[] = [];

  parts.push(state.ready.length
    ? `${state.ready.length} MCP ${plural(state.ready.length, 'server')} ready: ${state.ready.map(codexServerLabel).join(', ')}`
    : 'No MCP servers ready');
  if (state.needsAuth.length) {
    parts.push(`Needs sign-in: ${state.needsAuth.map(codexServerLabel).join(', ')}`);
  }
  if (state.unavailable.length) {
    parts.push(`Did not load: ${state.unavailable.map(codexServerLabel).join(', ')}`);
  }
  if (state.appFamilies.length) {
    parts.push(
      `Codex Apps: ${state.appFamilies.length} app ${plural(state.appFamilies.length, 'family', 'families')} — `
      + state.appFamilies.map(family => `${family.name} (${family.toolCount})`).join(', '),
    );
  }
  return parts.join(' | ');
}

export type McpHealth = 'connected' | 'needs-auth' | 'pending' | 'unknown';

export interface McpLiveServer {
  name: string;
  url: string;
  health: McpHealth;
  /** The CLI's own words, kept verbatim for anything we did not classify. */
  detail: string;
}

/** Symbols the CLI prints in front of each status. */
const HEALTH_BY_SYMBOL: Record<string, McpHealth> = {
  '✔': 'connected',
  '!': 'needs-auth',
  '⏸': 'pending',
};

/**
 * Parse `claude mcp list` output.
 *
 * A line looks like:
 *   claude.ai Google Drive: https://drivemcp.googleapis.com/mcp/v1 - ✔ Connected
 *   CortexMCP: https://cortex-brain-mcp.workers.dev (HTTP) - ⏸ Pending approval (run `claude` to approve)
 *
 * Names contain spaces and urls contain colons, so the split is positional
 * rather than delimiter-greedy: the LAST ' - ' ends the address, and the FIRST
 * ': ' ends the name (a url's own colon is never followed by a space).
 */
export function parseMcpList(stdout: string): McpLiveServer[] {
  const out: McpLiveServer[] = [];
  for (const raw of stdout.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const cut = line.lastIndexOf(' - ');
    if (cut === -1) continue; // header line ("Checking MCP server health…")
    const address = line.slice(0, cut);
    const status = line.slice(cut + 3).trim();
    const colon = address.indexOf(': ');
    if (colon === -1) continue;

    const name = address.slice(0, colon).trim();
    // Strip the transport suffix the CLI appends to .mcp.json entries.
    const url = address.slice(colon + 2).replace(/\s*\((HTTP|SSE|STDIO)\)\s*$/i, '').trim();
    if (!name || !url) continue;

    const symbol = status.slice(0, 1);
    out.push({
      name,
      url,
      health: HEALTH_BY_SYMBOL[symbol] ?? 'unknown',
      detail: (HEALTH_BY_SYMBOL[symbol] ? status.slice(1) : status).trim(),
    });
  }
  return out;
}

/** One line for a toast: the counts, then every server that is NOT fine, by
 *  name. Listing the healthy ones is noise — the whole reason to wait nine
 *  seconds is to learn which door is shut. */
export function summarizeMcpLive(servers: McpLiveServer[]): string {
  if (servers.length === 0) return 'No MCP servers configured';
  const by = (h: McpHealth) => servers.filter(s => s.health === h);
  const connected = by('connected').length;

  const parts = [`${connected}/${servers.length} connected (live)`];
  const problems: Array<[McpHealth, string]> = [
    ['needs-auth', 'Needs auth'],
    ['pending', 'Pending approval'],
    ['unknown', 'Unrecognised'],
  ];
  for (const [health, label] of problems) {
    const hit = by(health);
    if (hit.length) parts.push(`${label}: ${hit.map(s => s.name).join(', ')}`);
  }
  return parts.join(' | ');
}

// ---------------------------------------------------------------------------
// The lane's OWN inventory — what this session can actually use
// ---------------------------------------------------------------------------
//
// `claude mcp list` answers a different question than the one being asked. It
// says whether THIS BOX can reach a server; the user is asking what the window
// answering them can actually use. Those come apart exactly where it matters:
// measured Aug 13 2026, the subcommand said 14 of 19 connected while this
// window held 8 usable servers — it called four local ones "pending approval"
// whose tools were working, and seven claude.ai ones "connected" that the
// session had never even attempted.
//
// The session writes down its own verdict. Claude Code's transcript carries
// `deferred_tools_delta` records with `needsAuthMcpServers` and
// `pendingMcpServers`; the last one is the current state. That read costs
// milliseconds instead of nine seconds and is per lane, which the subcommand
// never was.
//
// It gives no positive list — there is no record of which tools loaded, only
// which did NOT — so this deliberately reports the locked-out ones and says
// everything else is in hand, rather than inventing a denominator.

export interface LaneMcpInventory {
  needsAuth: string[];
  pending: string[];
}

/** What this session did with one server. `connected` is the only one that
 *  means tools in hand; `failed` means it was tried and would not open;
 *  absence from the list entirely means it was never attempted. */
export type SessionMcpVerdict = 'connected' | 'failed';

export interface SessionMcpServer {
  name: string;
  verdict: SessionMcpVerdict;
  /**
   * Which road this reading came down. Absent means the CLI's own per-server
   * log, which is every MCP server. 'house' means the backend reached it
   * directly instead — the only way Cortex has ever arrived, and therefore the
   * only way it can appear in a list built from CLI logs it leaves no line in.
   */
  via?: 'house';
}

/** Un-mangle a log directory name back into the server's real name. The CLI
 *  writes `mcp-logs-claude-ai-Google-Drive` for "claude.ai Google Drive", so
 *  dashes are spaces and the leading `claude-ai` is the prefix. */
export function serverNameFromLogDir(dirName: string): string {
  const bare = dirName.replace(/^mcp-logs-/, '');
  const spaced = bare.replace(/-/g, ' ');
  return spaced.startsWith('claude ai ') ? `claude.ai ${spaced.slice(10)}` : spaced;
}

/** Pure: read one server's log lines for one session and say what happened.
 *  Returns null when this session never appears — which is the third state,
 *  and the one that matters: NOT ATTEMPTED is not the same claim as needs
 *  sign-in, and reporting seven working servers as needing a login was wrong
 *  in exactly that way. */
export function verdictFromLogLines(jsonl: string, sessionId: string): SessionMcpVerdict | null {
  let verdict: SessionMcpVerdict | null = null;
  for (const line of jsonl.split('\n')) {
    if (!line.includes(sessionId)) continue;
    let row: Record<string, unknown>;
    try { row = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
    if (row.sessionId !== sessionId) continue;
    const text = String(row.debug ?? row.error ?? row.message ?? '');
    if (text.startsWith('Successfully connected')) verdict = 'connected';
    else if (text.startsWith('Connection failed')) verdict = 'failed';
  }
  return verdict;
}

/** One line for a toast, led by what can actually be used: the list of what
 *  we hold rather than a count of what we do not — a number of "not
 *  connected" reads as broken when the truth was never attempted. */
export function summarizeSessionMcp(servers: SessionMcpServer[]): string {
  if (!servers.length) return 'No MCP servers recorded for this window yet.';
  // A house-road server is named the same as any other — it IS connected, and
  // the point of this readout is seeing what is connected. The suffix says how,
  // because that is the difference between "restart the lane" and "check the
  // worker" when one of them stops answering.
  const label = (s: SessionMcpServer) => (s.via === 'house' ? `${s.name} (via the house)` : s.name);
  const on = servers.filter(s => s.verdict === 'connected').map(label);
  const off = servers.filter(s => s.verdict === 'failed').map(label);
  const parts: string[] = [];
  parts.push(on.length ? `${on.length} in hand: ${on.join(', ')}` : 'Nothing connected in this window');
  if (off.length) parts.push(`Would not open: ${off.join(', ')}`);
  return parts.join(' | ');
}

/**
 * The brain, as a row for the readouts above.
 *
 * Returns null when no worker URL is set — an unconfigured Cortex has no row,
 * the same way a server this window never attempted has no line. A configured
 * one that will not answer DOES get a row, because that is the case worth
 * seeing: silence there used to look identical to not having a brain at all.
 */
export async function readHouseBrain(): Promise<SessionMcpServer | null> {
  const { probeCortex } = await import('./cortex.js');
  const probe = await probeCortex();
  if (!probe.configured) return null;
  return { name: 'Cortex', verdict: probe.ok ? 'connected' : 'failed', via: 'house' };
}

/** Anything that is the brain, whichever road it came down. The lane's MCP
 *  entry is named CortexMCP and the house row is named Cortex. */
const isBrainRow = (s: SessionMcpServer) => /^cortex/i.test(s.name);

/**
 * Pure: fold the two roads to the brain into one truthful row.
 *
 * Both are real and they can disagree — the MCP surface on this lane points at
 * the bare host and fails, while the backend reaches the worker fine. Printed
 * side by side that reads as the brain being both connected and shut, which is
 * the same false negative this whole readout was rebuilt to stop telling.
 *
 * So: a reachable brain wins and the failed MCP row goes. An unreachable one
 * does NOT get to hide the lane's own verdict — if neither road works, the row
 * that was already there stays exactly as it was.
 */
export function mergeBrainRows(
  fromCli: SessionMcpServer[],
  brain: SessionMcpServer | null,
): SessionMcpServer[] {
  if (!brain) return [...fromCli];
  const others = fromCli.filter(s => !isBrainRow(s));
  if (brain.verdict === 'connected') return [...others, brain].sort((a, b) => a.name.localeCompare(b.name));
  // Brain down: keep whatever the lane said about it, and only add our row if
  // the lane had nothing to say — otherwise the same failure is printed twice.
  const laneSaidSomething = fromCli.some(isBrainRow);
  const merged = laneSaidSomething ? [...fromCli] : [...fromCli, brain];
  return merged.sort((a, b) => a.name.localeCompare(b.name));
}

/** Both roads in one list, sorted by name so Cortex sits among the others
 *  rather than bolted on the end. Never throws: the brain check is additive,
 *  and a readout that dies because one probe timed out is worse than one that
 *  is missing a row. */
export async function readAllHeldServers(): Promise<SessionMcpServer[] | null> {
  const mine = readSessionMcpServers();
  let brain: SessionMcpServer | null = null;
  try { brain = await readHouseBrain(); }
  catch { /* additive only */ }
  if (!mine?.length) return brain ? [brain] : mine;
  return mergeBrainRows(mine, brain);
}

/** Pure: the LAST deferred_tools_delta in a transcript is the current state.
 *  Earlier ones are mid-startup and would report servers as pending that have
 *  long since arrived. */
export function parseLaneMcpInventory(jsonl: string): LaneMcpInventory | null {
  let found: LaneMcpInventory | null = null;
  for (const line of jsonl.split('\n')) {
    // Cheap string test before parsing — these files run to megabytes and only
    // a handful of lines are ever the record we want.
    if (!line.includes('deferred_tools_delta')) continue;
    let row: unknown;
    try { row = JSON.parse(line); } catch { continue; }
    const rec = row as Record<string, unknown>;
    const att = (rec.attachment ?? rec) as Record<string, unknown>;
    if (att.type !== 'deferred_tools_delta') continue;
    found = {
      needsAuth: Array.isArray(att.needsAuthMcpServers) ? att.needsAuthMcpServers as string[] : [],
      pending: Array.isArray(att.pendingMcpServers) ? att.pendingMcpServers as string[] : [],
    };
  }
  return found;
}

/** One line for a toast. Names only the doors that are shut, because the
 *  transcript cannot tell us which ones are open — only which are not. */
export function summarizeLaneMcp(inv: LaneMcpInventory): string {
  const parts: string[] = [];
  if (inv.needsAuth.length) parts.push(`Needs sign-in: ${inv.needsAuth.join(', ')}`);
  if (inv.pending.length) parts.push(`Still connecting: ${inv.pending.join(', ')}`);
  if (!parts.length) return 'Every MCP server configured for this lane is in hand.';
  parts.push('everything else configured for this lane is in hand');
  return parts.join(' | ');
}

/**
 * Newest transcript across every warm heartbeat lane, then its inventory.
 *
 * The transcript search mirrors the one /cost uses in commands.ts on purpose
 * rather than being shared: commands.ts imports this module, so importing it
 * back would close a cycle.
 */
export function readLaneMcpInventory(): LaneMcpInventory | null {
  const latest = newestHeartbeatSession();
  if (!latest) return null;
  try { return parseLaneMcpInventory(readFileSync(latest.path, 'utf-8')); }
  catch { return null; }
}

/** The newest transcript across every warm heartbeat lane, and the session id
 *  it is named for. A transcript's FILENAME is the session id, which is what
 *  lets the MCP logs below be filtered to this window rather than to whatever
 *  else has run `claude` on this box. */
function newestHeartbeatSession(): { path: string; sessionId: string; projectKey: string } | null {
  const root = join(homedir(), '.claude', 'projects');
  const lanesDir = join(PROJECT_ROOT, 'data', 'heartbeat');
  let lanes: string[];
  try { lanes = readdirSync(lanesDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); }
  catch { return null; }

  let latest: { path: string; sessionId: string; projectKey: string; mtime: number } | null = null;
  for (const lane of lanes) {
    const projectKey = projectKeyForDir(join(lanesDir, lane));
    const dir = join(root, projectKey);
    if (!existsSync(dir)) continue;
    try {
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.jsonl')) continue;
        const p = join(dir, f);
        const st = statSync(p);
        if (!latest || st.mtimeMs > latest.mtime) {
          latest = { path: p, sessionId: f.replace(/\.jsonl$/, ''), projectKey, mtime: st.mtimeMs };
        }
      }
    } catch { /* unreadable lane dir — skip it */ }
  }
  return latest;
}

/**
 * What THIS window actually holds, named.
 *
 * The transcript records only failures, so it can never list what loaded. The
 * CLI's per-server logs can: each one carries the session id and ends in
 * "Successfully connected (transport: http) in 489ms" or "Connection failed".
 * That is a positive, per-window verdict — the thing a count of absences was
 * getting wrong. Seven servers reported as needing a sign-in were working
 * fine; this window had simply never knocked, and a server never attempted
 * leaves no line here at all.
 */
export function readSessionMcpServers(): SessionMcpServer[] | null {
  const session = newestHeartbeatSession();
  if (!session) return null;
  const cacheDir = join(homedir(), '.cache', 'claude-cli-nodejs', session.projectKey);
  let dirs: string[];
  try { dirs = readdirSync(cacheDir, { withFileTypes: true }).filter(d => d.isDirectory() && d.name.startsWith('mcp-logs-')).map(d => d.name); }
  catch { return null; }

  const out: SessionMcpServer[] = [];
  for (const dirName of dirs) {
    const dir = join(cacheDir, dirName);
    let files: string[];
    // Newest first, and stop after a few: a server's log rotates per run and
    // this session's entry is in one of the most recent. Reading every file in
    // every directory would turn a millisecond read into a sweep.
    try {
      files = readdirSync(dir)
        .map(f => ({ f, m: statSync(join(dir, f)).mtimeMs }))
        .sort((a, b) => b.m - a.m).slice(0, 4).map(x => x.f);
    } catch { continue; }

    for (const f of files) {
      let verdict: SessionMcpVerdict | null = null;
      try { verdict = verdictFromLogLines(readFileSync(join(dir, f), 'utf-8'), session.sessionId); }
      catch { continue; }
      if (verdict) { out.push({ name: serverNameFromLogDir(dirName), verdict }); break; }
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Ask the CLI. Returns null on any failure — a caller that gets null must fall
 * back to the configured list AND say that is what it is doing. Presenting
 * stale configuration as a live reading is the one outcome worse than waiting.
 */
export async function readLiveMcpStatus(
  cwd: string = join(PROJECT_ROOT, 'data', 'heartbeat', 'primary'),
  timeoutMs = 30_000,
): Promise<McpLiveServer[] | null> {
  return new Promise(resolve => {
    execFile(
      'claude',
      ['mcp', 'list'],
      { cwd, timeout: timeoutMs, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        // A non-zero exit still prints the table on some paths, so parse what
        // arrived before deciding it failed.
        const parsed = stdout ? parseMcpList(stdout) : [];
        if (parsed.length) return resolve(parsed);
        if (err) console.warn('[mcp-live] claude mcp list failed:', err.message);
        resolve(null);
      },
    );
  });
}
