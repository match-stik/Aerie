// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import { readdir, stat, open, readFile } from 'fs/promises';
import { homedir } from 'os';
import { join, basename } from 'path';
import { CLAUDE_MODELS, extraModelsFor, normalizeModelId } from '../model-catalog.js';

/** Session metadata for the phone's Agent Sessions card. Mirrors the shape the
 * SDK's listSessions returned so the existing phone consumer needs no change. */
export interface AgentSessionInfo {
  sessionId: string;
  summary: string;
  lastModified: number;
  fileSize: number;
  customTitle?: string;
  firstPrompt?: string;
  gitBranch?: string;
  cwd?: string;
  createdAt?: number;
  /**
   * WHICH RESUME CHAIN THIS ROOM BELONGS TO. A resumed session does not copy
   * its parent's transcript, it RETYPES it — new file, new sessionId, new uuid
   * on every inherited record — so from the inside a chain of eight rooms looks
   * like eight separate conversations, each one containing all of the ones
   * before it. Measured on this box Sep 21 2026: one chain eight files deep,
   * 12 MB at the root and 123 MB at the tip, every earlier file's content fully
   * contained in the next.
   *
   * requestId is the one identifier that SURVIVES the retype, because it names
   * an API call rather than a line in a file. So the first assistant requestId
   * in a transcript is the same in every room of a chain, and it costs one head
   * read to get. Verified as exact containment on three pairs before shipping.
   */
  chainId?: string;
  /**
   * True when a NEWER room in this chain exists, which means this one was
   * resumed and everything in it has been retyped forward. Its usage is real
   * but it is also counted again in the newer room — see readSessionUsage.
   */
  supersededByResume?: boolean;
  /** Token totals for the whole session. See readSessionUsage. */
  usage?: SessionUsage;
}

/**
 * What a session cost, which is the only unit these numbers are honest in.
 * Every turn re-sends the entire conversation, so a per-turn prompt count is a
 * snapshot of the whole window — sum those across turns and you have counted
 * the same conversation once per turn. Per SESSION there is no double count:
 * output and cache writes are what each turn ADDED, and contextTokens is the
 * window's size when the session stopped, which is an endpoint rather than a
 * sum. The numbers were unusable in any other unit.
 *
 * THAT LAST CLAIM HOLDS WITHIN A ROOM AND NOT ACROSS A RESUME CHAIN, and the
 * sentence above was written before resume existed. A resumed room's transcript
 * is its parent RETYPED, inherited assistant records and all, so its per-session
 * totals include everything every earlier room in the chain did. Nothing here
 * can see that on its own — the retype mints a new sessionId and a new uuid for
 * every record. `chainId` and `supersededByResume` on the session row are what
 * carry it, so the tip of a chain is the only honest total in it.
 */
export interface SessionUsage {
  replies: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  contextTokens: number;
  model?: string;
  /** Why the session stopped, when it stopped on something other than a reply.
   *  See SYNTHETIC_MODEL — this is that entry's text, and it is the only place
   *  a usage cap or a 529 is written down where the phone can reach it. */
  endedWith?: string;
  /** The window contextTokens is measured against, from the model catalog —
   * resolved here so the phone never keeps its own copy of the model list. */
  contextWindow?: number;
}

// Transcripts carry the resolved dated id (claude-opus-4-5-20251101) while the
// catalog keys the plain form, so after an exact miss the longest catalog id
// that prefixes the dated one is the same model wearing its release date.
function contextWindowFor(modelId: string): number | undefined {
  const rows = [
    ...CLAUDE_MODELS.map(m => ({ id: m.id, window: m.context_length })),
    ...extraModelsFor('claude').map(m => ({ id: m.id, window: m.contextLength })),
  ].filter((r): r is { id: string; window: number } => typeof r.window === 'number' && r.window > 0);
  const exact = rows.find(r => r.id === modelId);
  if (exact) return exact.window;
  const norm = normalizeModelId(modelId);
  const prefixed = rows
    .filter(r => norm.startsWith(normalizeModelId(r.id)))
    .sort((a, b) => b.id.length - a.id.length)[0];
  return prefixed?.window;
}

// Resolved at call time, not cached with the counts: the catalog's extras can
// change between requests, and a finished transcript's cached totals must not
// pin a window that was looked up before the user added the model to the list.
function withContextWindow(usage: SessionUsage): SessionUsage {
  const contextWindow = usage.model ? contextWindowFor(usage.model) : undefined;
  return contextWindow ? { ...usage, contextWindow } : usage;
}

// When a session ends on an error rather than a reply — a usage cap, a 529, a
// model id the CLI will not accept — Claude Code appends one last assistant
// entry carrying the reason, modelled as '<synthetic>' with an all-zero usage
// block. It is a death certificate, not a turn: counting it as a reply inflates
// the count by one, and letting it be the LAST entry seen makes it the one that
// names the model and sizes the context, which reported the model as
// '<synthetic>' and the window as empty on eight of twenty-five sessions.
const SYNTHETIC_MODEL = '<synthetic>';
const ENDED_WITH_MAX = 200;

function syntheticText(entry: any): string | undefined {
  const text = extractText(entry?.message?.content);
  return text?.trim().slice(0, ENDED_WITH_MAX) || undefined;
}

/** The id every record of one API reply shares. Claude Code writes a reply as
 *  one record per content block (thinking, text, each tool call), and each of
 *  those records carries the reply's whole usage, so anything summing usage has
 *  to count a reply once, by this. Undefined means the record cannot be matched
 *  to any other and counts on its own. A resumed room's transcript keeps these
 *  ids, which is also what tells its retyped history apart. */
export function replyKey(entry: any): string | undefined {
  const id = entry?.message?.id;
  if (typeof id === 'string' && id) return id;
  const request = entry?.requestId;
  return typeof request === 'string' && request ? request : undefined;
}

// A finished transcript never changes again, so its totals are computed once
// and kept. Only the live session's file is ever re-read. Keyed on size+mtime
// so a file that DOES grow is recounted rather than trusted.
const usageCache = new Map<string, { key: string; usage: SessionUsage }>();

/** Sum a whole transcript. Measured at 221 MB across 20 sessions in 0.69s, so
 *  the full read is affordable even before the cache takes it to nothing. */
export async function readSessionUsage(filePath: string, size: number, mtime: number): Promise<SessionUsage | undefined> {
  const key = `${size}:${mtime}`;
  const hit = usageCache.get(filePath);
  if (hit && hit.key === key) return withContextWindow(hit.usage);

  const usage: SessionUsage = {
    replies: 0, inputTokens: 0, outputTokens: 0,
    cacheReadTokens: 0, cacheWriteTokens: 0, contextTokens: 0,
  };
  const counted = new Set<string>();
  try {
    const raw = await readFile(filePath, 'utf8');
    for (const line of raw.split('\n')) {
      // Cheap reject before the parse — most lines are tool traffic.
      if (!line.includes('"usage"')) continue;
      let entry: any;
      try { entry = JSON.parse(line); } catch { continue; }
      const u = entry?.type === 'assistant' ? entry.message?.usage : undefined;
      if (!u) continue;
      if (entry.message?.model === SYNTHETIC_MODEL) {
        usage.endedWith = syntheticText(entry) ?? usage.endedWith;
        continue; // never a reply, never the model, never the context
      }
      // Its other records repeat the same usage; the first one already counted.
      const key = replyKey(entry);
      if (key) {
        if (counted.has(key)) continue;
        counted.add(key);
      }
      usage.replies += 1;
      usage.inputTokens += u.input_tokens || 0;
      usage.outputTokens += u.output_tokens || 0;
      usage.cacheReadTokens += u.cache_read_input_tokens || 0;
      usage.cacheWriteTokens += u.cache_creation_input_tokens || 0;
      // Overwritten each time, so the last assistant message wins: the size of
      // the window at the end, not an accumulation of every prompt in it.
      usage.contextTokens =
        (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      if (typeof entry.message?.model === 'string') usage.model = entry.message.model;
    }
  } catch {
    return undefined;
  }
  // A session that produced nothing but a death certificate still gets a row:
  // an empty session that says why it is empty beats one that just reads zero.
  if (!usage.replies && !usage.endedWith) return undefined;
  usageCache.set(filePath, { key, usage });
  return withContextWindow(usage);
}

// Claude Code stores transcripts under ~/.claude/projects/<key>/<uuid>.jsonl
// where <key> is the absolute project dir with every non-alphanumeric replaced
// by '-'. Keys longer than 200 chars get a hash suffix upstream; house paths
// never get near that, so the plain form is all we need.
export function projectKeyForDir(dir: string): string {
  return dir.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 200);
}

// Titles, the first prompt, and git metadata all appear within the first few
// entries of a transcript; 256 KiB of head is plenty and keeps multi-MB
// session files cheap to scan.
const HEAD_BYTES = 256 * 1024;
const FIRST_PROMPT_MAX = 300;

// Claude Code auto-titles a warm lane from its opening turn, which is the
// provisioner's launch banner rather than anything that happened — so every
// heartbeat session gets the same name. Recognised so a real one can win.
const LAUNCH_BANNER = /^\s*(A fresh heartbeat session is starting|Initiali[sz]e[\w ]*heartbeat[\w ]*session)/i;

/** In a warm CLI lane the user's messages arrive as isMeta user entries prefixed with
 *  "Stop hook feedback:", which the normal parser skips as system noise. Here
 *  that entry IS the conversation, and the only thing that can name a session.
 *  Pull out the first line the user actually said. */
export function deliveredMessageTitle(text: string): string | undefined {
  if (!/^\s*Stop hook feedback:/i.test(text)) return undefined;
  const body = text.replace(/^\s*Stop hook feedback:\s*/i, '');
  // A recycled session wraps the user's line in an orientation dump that ends with a
  // marker; everything after it is what the user actually wrote.
  const parts = body.split(/\[End of context[^\]]*\]\s*/);
  const tail = parts.length > 1 ? parts[parts.length - 1] : body;

  let depth = 0;
  // The missed-inbound replay is a block like the bracketed ones, except its
  // body is the user's own words rather than orientation — so it is not what named
  // this session, but it IS a better title than nothing. Kept as a fallback
  // instead of being taken first, which is what put a raw replay line
  // ("<name> (<ISO time>): ...") on the Status app as a title.
  let missed = false;
  let replayed: string | undefined;

  for (const raw of tail.split('\n')) {
    const inside = depth > 0;
    depth = Math.max(0, depth + (raw.split('[').length - 1) - (raw.split(']').length - 1));
    const line = raw.trim();
    if (/^\[MISSED\b/i.test(line)) missed = true;
    else if (/^\[End of missed messages/i.test(line)) missed = false;
    // Orientation, recall, wake and proposal blocks are bracketed and span
    // several lines, so tracking depth is the only way past their middles.
    if (inside || !line || line.startsWith('[') || line.startsWith('-')) continue;
    const spoken = line
      // The inbox format a user message arrives in: "[h:mm PM] #channel <name>: ...".
      .replace(/^\[[^\]]*\]\s*#\S+\s+[^:]+:\s*/, '')
      // The replay format a missed message arrives in: "<name> (2026-...Z): ...".
      .replace(/^[^:(]{1,40}\s*\(\d{4}-\d{2}-\d{2}T[^)]*\):\s*/, '')
      .trim();
    // A stray bracket or a bullet fragment is not a title.
    if ((spoken.match(/\w/g) || []).length < 8) continue;
    if (missed) { replayed = replayed ?? spoken.slice(0, FIRST_PROMPT_MAX); continue; }
    return spoken.slice(0, FIRST_PROMPT_MAX);
  }
  if (replayed) return replayed;
  const wake = tail.split('\n').map(l => l.trim()).find(l => l.startsWith('[WAKE:'));
  return wake?.slice(0, FIRST_PROMPT_MAX);
}

function extractText(content: unknown): string | undefined {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block && typeof block === 'object' && (block as any).type === 'text') {
        const text = (block as any).text;
        if (typeof text === 'string' && text.trim()) return text;
      }
    }
  }
  return undefined;
}

async function readHead(filePath: string): Promise<string> {
  const handle = await open(filePath, 'r');
  try {
    const buf = Buffer.allocUnsafe(HEAD_BYTES);
    const { bytesRead } = await handle.read(buf, 0, HEAD_BYTES, 0);
    return buf.toString('utf8', 0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * The first assistant requestId in a transcript — the chain key. Cheap on
 * purpose: it comes out of the head bytes already read for the title, and a
 * transcript with no assistant record yet simply has no chain.
 */
export function parseChainId(head: string): string | undefined {
  for (const line of head.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes('"requestId"')) continue;
    try {
      const entry = JSON.parse(trimmed);
      if (entry?.type === 'assistant' && typeof entry.requestId === 'string' && entry.requestId) {
        return entry.requestId;
      }
    } catch {
      // A head read cuts the last line in half; that is expected, not a fault.
    }
  }
  return undefined;
}

export function parseSessionHead(head: string): Omit<AgentSessionInfo, 'sessionId' | 'lastModified' | 'fileSize' | 'usage'> {
  let summary = '';
  let customTitle: string | undefined;
  let firstPrompt: string | undefined;
  let gitBranch: string | undefined;
  let cwd: string | undefined;
  let createdAt: number | undefined;
  let delivered: string | undefined;

  for (const line of head.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: any;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue; // last line of the head window is usually truncated
    }
    if (!entry || typeof entry !== 'object') continue;

    if (entry.type === 'ai-title' && typeof entry.aiTitle === 'string') {
      summary = summary || entry.aiTitle;
    } else if (entry.type === 'custom-title') {
      const title = entry.customTitle ?? entry.title;
      if (typeof title === 'string' && title.trim()) customTitle = title;
    } else if (entry.type === 'summary' && typeof entry.summary === 'string') {
      summary = summary || entry.summary;
    } else if (entry.type === 'user' && !delivered && entry.isMeta && !entry.isSidechain) {
      const text = extractText(entry.message?.content);
      if (text) delivered = deliveredMessageTitle(text);
    } else if (entry.type === 'user' && !firstPrompt && !entry.isMeta && !entry.isSidechain && !entry.isCompactSummary) {
      const content = entry.message?.content;
      if (!(Array.isArray(content) && content.some((b: any) => b?.type === 'tool_result'))) {
        const text = extractText(content);
        if (text) firstPrompt = text.trim().slice(0, FIRST_PROMPT_MAX);
      }
    }

    if (!gitBranch && typeof entry.gitBranch === 'string' && entry.gitBranch) gitBranch = entry.gitBranch;
    if (!cwd && typeof entry.cwd === 'string' && entry.cwd) cwd = entry.cwd;
    if (createdAt === undefined && typeof entry.timestamp === 'string') {
      const ts = Date.parse(entry.timestamp);
      if (!Number.isNaN(ts)) createdAt = ts;
    }
  }

  // A boilerplate lane title loses to anything the user actually said, but is still
  // kept as the last resort so no session comes back nameless.
  const real = LAUNCH_BANNER.test(summary) ? '' : summary;
  return {
    summary: real || delivered || firstPrompt || summary || '',
    customTitle,
    firstPrompt,
    gitBranch,
    cwd,
    createdAt,
  };
}

/** Every project dir holding this house's transcripts. Claude Code keys them by
 *  working directory, and the warm CLI lanes each run in their own — so the agent
 *  cwd alone stops dead at the day the house left the SDK lane. The phone's
 *  Sessions list went quiet on 9 July 2026 for exactly that reason: nothing was
 *  broken, it was still pointed at the room everyone had moved out of. */
async function houseProjectDirs(dir: string): Promise<string[]> {
  const keys = [projectKeyForDir(dir)];
  const heartbeatRoot = join(dir, 'data', 'heartbeat');
  try {
    for (const lane of await readdir(heartbeatRoot, { withFileTypes: true })) {
      if (lane.isDirectory()) keys.push(projectKeyForDir(join(heartbeatRoot, lane.name)));
    }
  } catch {
    // No heartbeat lanes on this box — the agent cwd is the whole story.
  }
  const root = join(homedir(), '.claude', 'projects');
  return [...new Set(keys)].map(k => join(root, k));
}

async function newestInDir(projectDir: string, limit: number) {
  let names: string[];
  try {
    names = (await readdir(projectDir)).filter(n => n.endsWith('.jsonl'));
  } catch {
    return [];
  }
  const stats = await Promise.all(names.map(async name => {
    const filePath = join(projectDir, name);
    try {
      const s = await stat(filePath);
      return { filePath, mtime: s.mtimeMs, size: s.size };
    } catch {
      return null;
    }
  }));
  // Trimmed per directory before merging: the global newest N always lives inside
  // the union of each directory's newest N, and the lanes hold thousands of files.
  // The size floor is a cheap pre-filter, not the real gate — a lane that failed
  // to launch writes ~13 KB of pure banner and nothing else, and thousands of
  // those would eat the whole quota before anything with content in it is read.
  // Sessions that did start clear this comfortably; the content check below is
  // what actually decides.
  return stats
    .filter((s): s is NonNullable<typeof s> => s !== null && s.size > 16 * 1024)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);
}

/** List Claude Code sessions for this house from local transcript storage. */
export async function listAgentSessions(dir: string, limit = 50): Promise<AgentSessionInfo[]> {
  const dirs = await houseProjectDirs(dir);
  const perDir = await Promise.all(dirs.map(d => newestInDir(d, limit)));

  const newest = perDir
    .flat()
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);

  const sessions = await Promise.all(newest.map(async ({ filePath, mtime, size }): Promise<AgentSessionInfo | null> => {
    try {
      const head = await readHead(filePath);
      const [meta, usage] = await Promise.all([
        Promise.resolve(parseSessionHead(head)),
        readSessionUsage(filePath, size, mtime),
      ]);
      return {
        sessionId: basename(filePath, '.jsonl'),
        lastModified: mtime,
        fileSize: size,
        chainId: parseChainId(head),
        ...meta,
        usage,
      };
    } catch {
      return null;
    }
  }));

  // A lane that failed to launch still writes a transcript, containing nothing
  // but the banner — the auth crash-loop on 4 Aug left sixty byte-identical
  // ones, which would bury every real session. Anything that got a single turn
  // has a title, a delivered message or a first prompt, so nothing with
  // content in it is dropped here.
  const kept = sessions.filter((s): s is AgentSessionInfo =>
    s !== null && Boolean(s.customTitle || (s.summary && !LAUNCH_BANNER.test(s.summary))));

  return markResumeChains(kept);
}

/**
 * Flag every room in a resume chain except the newest. The tip contains all of
 * them — its transcript is theirs retyped — so it is the only row in the chain
 * whose usage is not also somebody else's. Nothing is removed from the list:
 * these are real rooms the user sat in and some of them ended in ways worth reading.
 * The flag is so a total can stop being wrong, not so a session can disappear.
 */
export function markResumeChains(rows: AgentSessionInfo[]): AgentSessionInfo[] {
  const newestOf = new Map<string, number>();
  for (const row of rows) {
    if (!row.chainId) continue;
    const seen = newestOf.get(row.chainId);
    if (seen === undefined || row.lastModified > seen) newestOf.set(row.chainId, row.lastModified);
  }
  return rows.map(row => {
    if (!row.chainId) return row;
    const tip = newestOf.get(row.chainId);
    return tip !== undefined && row.lastModified < tip
      ? { ...row, supersededByResume: true }
      : row;
  });
}
