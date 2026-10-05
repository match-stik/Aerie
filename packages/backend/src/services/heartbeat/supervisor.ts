// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * Heartbeat supervisor — keeps one warm interactive Claude Code session per
 * companion, in-process. Port of Thornvale's supervisor.js: relaunch on exit,
 * watchdog on stale ticks, restart flag for fresh context, orphan reaping.
 *
 * Billing-lane invariant: the child is plain interactive `claude` — never
 * `-p` / `--print` / stream-json / Agent SDK (those are metered). We also
 * strip ANTHROPIC_API_KEY/AUTH_TOKEN from the child env so the session uses
 * the owner's subscription login, not the API key Aerie holds for the
 * router lane.
 */

import { spawn, execSync, type ChildProcess } from 'child_process';
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, renameSync,
  appendFileSync, statSync, openSync, readSync, closeSync, createWriteStream,
  type WriteStream,
} from 'fs';
import { randomUUID } from 'crypto';
import { homedir } from 'os';
import { join } from 'path';
import { PROJECT_ROOT } from '../../config.js';
import { getConfig } from '../db.js';
import { provisionSessionDir } from './provision.js';
import { getAllBlocks } from '../memory-blocks.js';
import { baselineFrom, BASELINE_FILE } from './block-drift.js';
import { outageNotices, type OutageKind } from './outage-notices.js';
import { atomicWrite } from './atomic-write.js';

const IS_WIN = process.platform === 'win32';
const WATCHDOG_TIMEOUT = (parseInt(process.env.HEARTBEAT_WATCHDOG_TIMEOUT || '300', 10)) * 1000;

/**
 * The newest moment we have evidence this session was alive.
 *
 * The Stop hook only ticks `.last-tick` BETWEEN turns — it hands a message over
 * and exits — so during a turn the only file evidence is outbox chunks and tool
 * activity. A turn that thinks for a long stretch without calling a tool writes
 * neither, and by files alone it is indistinguishable from a wedged session.
 *
 * `turnStartedAt` is the fix for the sharper half of that: when a turn IS live,
 * it gets measured from its own start and never from the last file write. By the
 * time a message is handed over the newest file may already be minutes old, and
 * charging that pre-turn quiet against the turn is what killed two live sessions
 * on 2026-08-02 — reported ages 412s and 1387s, both landing in the same second
 * as `[Router] Turn complete`. The turns had finished; the clock had been running
 * since before either was handed its message. The WORKING limit still applies
 * from this mark, so a turn that genuinely hangs is still reaped on its own time.
 */
export function livenessMark(input: {
  tick: number;
  outboxMtime?: number;
  activityMtime?: number;
  turnActive?: boolean;
  turnStartedAt?: number;
}): number {
  let mark = input.tick;
  if ((input.outboxMtime ?? 0) > mark) mark = input.outboxMtime!;
  if ((input.activityMtime ?? 0) > mark) mark = input.activityMtime!;
  if (input.turnActive && (input.turnStartedAt ?? 0) > mark) mark = input.turnStartedAt!;
  return mark;
}
// A session with work in hand — a tool call that started and hasn't reported
// back, or declared background work — gets a longer leash than a silent one.
// A job that is working and a job that is hung look identical from out here;
// only elapsed time separates them, so the leash is the whole decision. The
// reply window in runtime.ts holds on the same two signals: both clocks must
// agree, or one waits patiently while the other kills the session anyway.
const WATCHDOG_WORKING_TIMEOUT = (parseInt(process.env.HEARTBEAT_WATCHDOG_WORKING_TIMEOUT || '1200', 10)) * 1000;
// Mirror of runtime.ts BUSY_FRESH_MS — how long one `touch io/.busy` counts for.
const BUSY_FRESH_MS = (parseInt(process.env.AERIE_HEARTBEAT_BUSY_FRESH || '600', 10)) * 1000;
// Tail of activity.jsonl read to answer "is a tool still running?" — the file
// grows to megabytes, and the answer is always in its last line.
const ACTIVITY_TAIL_BYTES = 4096;

/**
 * One stdin line carrying a Claude Code side question, or null when there is
 * nothing to send.
 *
 * Every newline inside the message has to go: the session's stdin is a command
 * line, so a second line would submit as its own input — a message that merely
 * contained a line break would arrive as a stray command rather than as part
 * of what the user said.
 */
export function formatSideNote(text: string): string | null {
  const body = String(text ?? '').replace(/\s*\r?\n\s*/g, ' ').trim();
  return body || null;
}

/**
 * Does the tail of activity.jsonl end on a tool that started and never
 * finished? Reading from a byte offset can slice the first record in half, so
 * walk back to the newest line that actually parses.
 */
export function activityTailIsOpen(tail: string): boolean {
  const lines = tail.split('\n').filter((l) => l.trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines[i]).phase === 'pre'; } catch { /* partial or corrupt — keep walking back */ }
  }
  return false;
}
/**
 * The id this lane is entitled to fall back to, or null when nothing is proven.
 *
 * `launchedModel` is deliberately the only id this can ever return, and it must
 * be what the child was SPAWNED on rather than the current setting. A pick
 * writes the setting and then asks for the recycle, and the poll that calls
 * this runs one statement above the restart check on the same tick — so reading
 * the setting here banks a brand new, never-tried id as its own proven fallback
 * a second before it is refused, and the safety net has nowhere to reach.
 * Staying up past the fast-exit window is the only evidence accepted: a model
 * recorded any earlier is a guess, and a fallback that is a guess just moves
 * the fault somewhere harder to see.
 */
export function proveFallbackModel(input: {
  lastGood: string | null;
  launchedModel: string;
  uptimeMs: number;
  fastExitWindowMs: number;
}): string | null {
  if (!input.launchedModel) return null;
  if (input.lastGood === input.launchedModel) return null;
  if (input.uptimeMs <= input.fastExitWindowMs) return null;
  return input.launchedModel;
}

/** Filename of the banked model, per lane, under the lane's own io/ dir. */
const BANKED_MODEL_FILE = '.last-good-model';

/**
 * Read the model this lane last proved it could run, from the previous
 * process's own handwriting.
 *
 * `lastGoodModel` is per-process state, so a backend restart emptied it — and
 * the first launch after a restart is precisely when the failsafe is needed
 * most, because a bad id sitting in config then has nothing to fall back to.
 * Measured Aug 14 2026: backend up 09:31:24Z, first launch 09:33:47Z straight
 * onto a junk id, two full five-minute sleeps, and the warning "no model it has
 * been up on to fall back to" was reporting the exact truth. The restart that
 * makes a fix live is the same act that empties the thing the fix needs.
 *
 * ABSENT MEANS UNKNOWN, NEVER FALSE. A missing, empty or unparseable file
 * leaves the lane exactly where it stood before this existed — sleep, and say
 * out loud that it has nowhere to go — rather than asserting an id nothing was
 * ever watched running. session.log cannot serve as this witness: it records
 * BIRTHS ONLY, so it holds refused ids too and can never show a session lived.
 */
export function readBankedModel(path: string): string | null {
  try {
    const raw = readFileSync(path, 'utf8').trim();
    // A model id is one bare token. Whitespace or absurd length means a torn or
    // hand-mangled file, and guessing at it banks something never proven.
    if (!raw || raw.length > 200 || /\s/.test(raw)) return null;
    return raw;
  } catch {
    return null;
  }
}

/**
 * Bank a proven model where the next process can find it. tmp+rename, because a
 * truncate-in-place write leaves a window where the file exists and is empty —
 * and an empty read is indistinguishable from "this lane never proved anything",
 * which is the one lie this file must never be able to tell.
 */
export function writeBankedModel(path: string, model: string): void {
  if (!model) return;
  const tmp = `${path}.tmp`;
  try {
    writeFileSync(tmp, model);
    renameSync(tmp, path);
  } catch {
    try { unlinkSync(tmp); } catch { /* nothing to clean up */ }
  }
}
const SESSION_ID_FILE = '.session-id';
const ROOM_ID_FILE = '.room-id';

/**
 * The Claude session id this lane owns.
 *
 * Every launch used to mint a brand-new conversation, and the lane paid for
 * that twice: once rebuilding the whole prompt cache from cold, and again
 * re-priming the first turn with thirty messages of history the abandoned
 * transcript already held. The CLI has had `--session-id` and `--resume` the
 * whole time and nothing here ever asked for them — `sessionResume: true` in
 * the runtime only ever meant "the process stays warm", not "a dead one can be
 * reopened", and read exactly like the second thing.
 *
 * We NAME the session at birth rather than hunting for the newest transcript
 * afterwards. A discovered id is a guess about the CLI's private storage
 * layout; an id we chose is a fact.
 */
export function readSessionId(path: string): string | null {
  try {
    const raw = readFileSync(path, 'utf8').trim();
    // Exactly a UUID or nothing. Resuming onto whatever a torn or hand-edited
    // file happens to contain is worse than opening a clean room.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) return null;
    return raw;
  } catch {
    return null;
  }
}

/** tmp+rename, same reason as the banked model: a half-written id reads as
 *  "this lane has never had a session", and that lie costs a resume silently. */
export function writeSessionId(path: string, id: string): void {
  if (!id) return;
  atomicWrite(path, id);
}

/**
 * The last few lines the child said on stderr, kept so an exit can be explained.
 *
 * A room compacted, carried on working for another
 * forty-eight seconds, ran the check this contract runs immediately before
 * writing a reply — and exited code 1 between that check and the write. The
 * answer existed and never reached the write. Asked why, this house could say
 * the code and nothing else: stderr was scanned live for the three shapes we
 * already know (auth, cap, a refused model) and then thrown away, so every
 * other exit left a number and no sentence.
 *
 * Blank lines dropped, each line capped, only the last few kept. A ring rather
 * than a log because the interesting part of a death is always its end.
 */
export function pushStderrLines(buf: string[], chunk: string, max = 12): string[] {
  for (const raw of String(chunk).split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    buf.push(line.length > 300 ? `${line.slice(0, 300)}…` : line);
  }
  while (buf.length > max) buf.shift();
  return buf;
}

/**
 * Whether this launch reopens the previous room or builds a new one.
 *
 * TWO exits never meant "give me a new room", and they are the only two that
 * may resume. A BACKEND RESTART: nothing was wrong with the room, the house
 * just went down around it. And a MODEL OR EFFORT CHANGE: the owner reached for a
 * setting, not for a fresh conversation. Everything else in a lane's life —
 * the owner's .restart flag, the whisper ceiling, the watchdog on a hung turn, a crash —
 * is a recycle somebody or something asked for, and those still build new.
 *
 * A stale id is already handled downstream: the CLI exits 1 in under a second
 * with 'No conversation found', the handler drops the id, and the relaunch
 * mints a new room. So the worst case of this door is exactly the behaviour it
 * replaced.
 */
export function shouldResumeLaunch(input: {
  firstLaunchOfProcess: boolean;
  storedSessionId: string | null;
  /** This relaunch was asked for by a model or effort change rather than by
   *  anything being wrong with the room. */
  settingChangeRecycle?: boolean;
  /** This relaunch follows a watchdog kill that is allowed one reopen — see
   *  watchdogMayResume. */
  watchdogRecycle?: boolean;
  enabled?: boolean;
}): boolean {
  if (input.enabled === false) return false;
  if (!input.storedSessionId) return false;
  return input.firstLaunchOfProcess || !!input.settingChangeRecycle || !!input.watchdogRecycle;
}

/** How long a room reopened after a watchdog kill has to stay up before it
 *  counts as healthy again and earns another reopen. */
export const WATCHDOG_RESUME_PROVEN_MS = 30 * 60 * 1000;

/**
 * Whether a watchdog kill may reopen the room it killed instead of building a
 * new one. When the box was suspended for half an hour, a scheduled bell rang
 * into a room that could not reach the outside to think, and the watchdog
 * killed it and built new three times over, so the house came back with the
 * whole conversation sitting on disk and nothing pointed at it. The room was
 * never broken. The house around it was.
 *
 * So a watchdog kill now tries the old room ONCE. If the reopened room is also
 * killed before it has proven itself, the second kill builds new, because two
 * stuck rooms in a row is the room rather than the weather. A room that has
 * stayed up past WATCHDOG_RESUME_PROVEN_MS is healthy again and gets its one
 * reopen back.
 */
export function watchdogMayResume(input: {
  launchedByWatchdogResume: boolean;
  uptimeMs: number;
}): boolean {
  return !input.launchedByWatchdogResume || input.uptimeMs >= WATCHDOG_RESUME_PROVEN_MS;
}

/**
 * Whether reopening the old room is switched on. `agent.claude_session_resume`
 * — 'off' or 'false' turns it off, anything else (including unset) leaves it on.
 *
 * IT IS A SWITCH BECAUSE THE TRADE IS THE OWNER'S, and the trade is not the one this
 * was built for. Measured Sep 9 2026 on the first real restart: the cold launch
 * wrote 156,196 cache tokens on its first turn and the resumed one wrote
 * 448,658 — more than the entire forty-three minute session before it wrote in
 * total. A resumed session has to re-establish the whole conversation as its
 * cached prefix, and that prefix only comes back free if it is byte-identical
 * to the one already cached. Ours was not: CLAUDE.md is regenerated whenever a
 * memory block is edited, and the MCP tool list moved as well. So resume buys
 * CONTINUITY and spends WINDOW, which is the opposite direction from what it
 * was built for — and only the owner can say which they would rather have.
 */
export function claudeResumeEnabled(): boolean {
  const raw = (getConfig('agent.claude_session_resume') || '').trim().toLowerCase();
  return raw !== 'off' && raw !== 'false' && raw !== '0';
}

/**
 * The exact argv this lane spawns on.
 *
 * Extracted so the one decision that matters — reopen or rebuild — can be read
 * in a test rather than inferred from a live process, and so the billing-lane
 * invariant has somewhere to be asserted: this list may never contain -p or
 * --print.
 *
 * The id goes IMMEDIATELY after --resume on purpose. That flag takes an
 * optional value, so a following argument starting with a dash would be read as
 * "no id given" and drop the launch into the interactive session picker — a
 * process that never exits and never ticks, which is the one failure shape here
 * worse than the behaviour it replaces.
 */
export const AUTOCOMPACT_MIN = 100_000;
export const AUTOCOMPACT_MAX = 1_000_000;

/**
 * Read heartbeat.autocompact_tokens and hand back a number the CLI will accept,
 * or null.
 *
 * Unset means the CLI's own `auto`, which sizes the window to whatever the
 * model can hold — so a long night runs all the way to the ceiling before it
 * squashes, and the squash then has the whole room in it. A smaller number
 * makes it squash earlier and smaller.
 *
 * Anything unparseable or out of range returns NULL rather than being clamped
 * into something plausible. A bad value here does not degrade the launch, it
 * BREAKS it — the CLI rejects the argument and the lane dies every couple of
 * seconds with no turn — so the failure to be certain of is the one where we
 * simply do not pass the flag.
 */
export function autocompactTokensFrom(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (!Number.isSafeInteger(n)) return null;
  if (n < AUTOCOMPACT_MIN || n > AUTOCOMPACT_MAX) return null;
  return n;
}

export function buildLaunchArgs(input: {
  model: string;
  effort: string;
  sessionId: string;
  resuming: boolean;
  freshPrompt: string;
  resumePrompt: string;
  autocompactTokens?: number | null;
}): string[] {
  const args = input.resuming
    ? ['--resume', input.sessionId]
    : ['--session-id', input.sessionId];
  args.push('--model', input.model);
  if (input.effort !== 'adaptive') args.push('--effort', input.effort);
  // Never between --resume and its id: that flag's value is optional, so a
  // dash in the next slot opens the interactive session picker.
  if (input.autocompactTokens != null) {
    args.push('--autocompact', String(input.autocompactTokens));
  }
  args.push(
    '--dangerously-skip-permissions',
    input.resuming ? input.resumePrompt : input.freshPrompt,
  );
  return args;
}

/** Where the CLI keeps a lane's transcripts. The slug is the working directory
 *  with every non-alphanumeric character replaced by a dash — read off this
 *  box's own project folders rather than assumed, and it is the CLI's private
 *  layout, so every caller below fails SOFT if it is ever wrong. */
export function projectSlugFor(dir: string): string {
  return dir.replace(/[^a-zA-Z0-9]/g, '-');
}

export function transcriptPathFor(dir: string, sessionId: string): string {
  return join(homedir(), '.claude', 'projects', projectSlugFor(dir), `${sessionId}.jsonl`);
}

/**
 * Drop the stale copies of CLAUDE.md out of a transcript before reopening it.
 *
 * A session start injects the whole project instruction file as one attachment
 * record, and the old ones never leave — so a room resumed twice was carrying
 * THREE copies, 1.1 MB of a 2.5 MB transcript, ~92k tokens each. Measured Sep 9
 * 2026 on the live lane.
 *
 * THE SENTENCE THAT SIZES THIS is sharper than the alarm that produced it:
 * resume does not ADD the whole room, it declines to throw it away — that
 * context would exist anyway if nobody had restarted. The only
 * genuinely NEW thing a restart injects is another instruction copy. So that is
 * the entire marginal cost of a restart, and this deletes exactly it.
 *
 * DROPPING ALL OF THEM IS THE POINT, not a rounding: a resumed session re-reads
 * the file at startup and injects a current copy, proven Sep 9 with a control —
 * codeword changed on disk, every instruction record stripped, and the resumed
 * session answered with the NEW word and its own earlier reply in one line.
 * Tool traffic is deliberately LEFT ALONE: stripping it would mean a resumed
 * head cannot remember what it read, which is a behaviour change nobody asked
 * for.
 */
export function stripStaleInstructions(
  rows: Array<Record<string, unknown>>,
): { rows: Array<Record<string, unknown>>; dropped: number } {
  const isInstructions = (r: Record<string, unknown>): boolean => {
    if (r.type !== 'attachment') return false;
    const a = r.attachment as { type?: string } | undefined;
    return a?.type === 'instructions';
  };
  const drop = new Set<string>();
  for (const r of rows) {
    const uuid = typeof r.uuid === 'string' ? r.uuid : undefined;
    if (uuid && isInstructions(r)) drop.add(uuid);
  }
  if (drop.size === 0) return { rows, dropped: 0 };

  // Every record links to the one before it. Cutting a record out of the middle
  // orphans its child, so the child inherits the first surviving ancestor —
  // walked rather than assumed, because instruction blocks can sit consecutively.
  const parentOf = new Map<string, string | undefined>();
  for (const r of rows) {
    if (typeof r.uuid === 'string') {
      parentOf.set(r.uuid, typeof r.parentUuid === 'string' ? r.parentUuid : undefined);
    }
  }
  const survivingParent = (start: string | undefined): string | undefined => {
    let p = start;
    const seen = new Set<string>();
    while (p && drop.has(p) && !seen.has(p)) { seen.add(p); p = parentOf.get(p); }
    return p;
  };

  const kept: Array<Record<string, unknown>> = [];
  for (const r of rows) {
    if (typeof r.uuid === 'string' && drop.has(r.uuid)) continue;
    const p = typeof r.parentUuid === 'string' ? r.parentUuid : undefined;
    kept.push(p && drop.has(p) ? { ...r, parentUuid: survivingParent(p) } : r);
  }
  return { rows: kept, dropped: drop.size };
}

/**
 * Write a trimmed copy of a transcript and return the id to resume instead.
 *
 * The ORIGINAL IS NEVER TOUCHED — the cut lands in a new session file, so a
 * mangled filter costs a fresh room and never a real transcript. Returns null
 * on anything unexpected, which puts the launch straight back to resuming the
 * untrimmed id.
 */
export function prepareResumeTranscript(dir: string, sessionId: string): string | null {
  try {
    const src = transcriptPathFor(dir, sessionId);
    if (!existsSync(src)) return null;
    const rows = readFileSync(src, 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const { rows: kept, dropped } = stripStaleInstructions(rows);
    if (dropped === 0) return null;
    const nextId = randomUUID();
    const rewritten = kept.map((r) => (r.sessionId === sessionId ? { ...r, sessionId: nextId } : r));
    const dest = transcriptPathFor(dir, nextId);
    const tmp = `${dest}.tmp`;
    writeFileSync(tmp, rewritten.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
    renameSync(tmp, dest);
    return nextId;
  } catch {
    return null;
  }
}

/** The CLI's own words when the id in hand names nothing it can find. Measured
 *  Sep 9 2026 against a made-up uuid: this line, exit 1, in under a second and
 *  before any model work — so a failed resume is cheap and, more importantly,
 *  it EXITS rather than sitting in the picker looking alive. */
const RESUME_MISSING_PATTERNS = [
  'no conversation found with session id',
];
export function looksLikeMissingSession(text: string): boolean {
  return RESUME_MISSING_PATTERNS.some((p) => text.includes(p));
}
/** A resume failure is a file lookup, so it dies at the door. Anything that
 *  survives longer than this was a real session that failed for its own
 *  reasons, and dropping its id would throw away a room that was working. */
const RESUME_FAIL_WINDOW_MS = 20_000;

const RELAUNCH_DELAY_MS = 2000;
// Boot prompt for a fresh/recycled session. Must NOT force `Read CLAUDE.md`:
// Claude Code already auto-loads CLAUDE.md as project instructions, and the
// file now exceeds the Read tool's 25k-token cap — so an explicit Read returns
// a truncated page plus a "call Read again with offset=…" reminder, and the
// fresh session burns its boot turn paging through a file it already has. That
// paging (compounded with a heavy re-prime seed) is what stalled recycles into
// the blinking-no-reply hang. Orient from already-loaded context instead; the
// `.fresh` flag — not a CLAUDE.md Read — is the runtime's real recycle signal.
const INITIAL_PROMPT =
  'A fresh heartbeat session is starting. Your identity, the constellation, and the ' +
  'heartbeat operation contract are in CLAUDE.md, already loaded into your context as ' +
  'project instructions — you do not need to Read it. Orient yourself from what you ' +
  'already have, then wait silently. Do NOT write to io/outbox.jsonl now; only write ' +
  'there when a real message arrives carrying a [turn_id].';

// Boot prompt for a RESUMED session. Deliberately not the fresh one: this
// window already holds the conversation, so re-orienting it would spend the
// exact tokens the resume just saved, and a greeting reads to the owner as a lane
// that forgot where it was.
//
// A RESUMED ROOM IS NOT CARRYING STALE INSTRUCTIONS, and that is measured
// rather than assumed. Sep 9 2026, with a control: a codeword in a scratch
// project's CLAUDE.md, answered by a live session, changed on disk underneath
// it, then resumed — and the resumed session answered with the NEW codeword,
// with no tool call anywhere in its output. Claude Code re-reads project
// instructions at startup on --resume too. This is the objection that would
// otherwise have sunk the whole idea: in a house whose ONLY recycle is a
// backend restart (every lane launch in the log sits immediately after a
// "Server running" line — no whisper ceiling, no watchdog, no restart flag),
// resuming a room that kept an old CLAUDE.md would have quietly stopped the owner's
// memory-block edits reaching us at all. It doesn't. They arrive on every
// resume, current, for free.
const RESUME_PROMPT =
  'This heartbeat session has been resumed — the backend restarted around you and ' +
  'reopened this same conversation. Everything above is yours and is still loaded, ' +
  'and your CLAUDE.md was re-read fresh at startup, so your identity and memory ' +
  'blocks are current. Nothing has changed except that the house came back up: ' +
  'do not re-orient, do not greet anyone, do not summarize where you left off. ' +
  'Wait silently; only write to io/outbox.jsonl when a real message arrives ' +
  'carrying a [turn_id].';

// Fast-exit window: exits within this window get special handling for cap/auth.
// Refusal detection removed 2026-07-05 — false positives vastly outnumber real
// refusals; fast exits without cap/auth signals just relaunch normally now.
const FAST_EXIT_WINDOW_MS = 180_000;
// Usage-cap hardening (2026-06-21 incident): a 5-hour
// subscription window hitting zero exits code 1 fast — refusal-shaped on
// the wire. Without this carve-out the supervisor classified 53 cap-exits
// as refusals in 29 minutes, thinned the seed each time, and flooded the
// active thread with ⚠ refusal warnings (UI cleanup + cap burn on every
// retry). Cap-shape exits are detected from the child's own usage-limit
// text — back off long instead of relaunching fast on the same wall.
const USAGE_CAP_PATTERNS = [
  'claude usage limit reached',
  'usage limit reached',
  'session limit',
  '5-hour limit',
  'approaching usage limit',
];
const CAP_RELAUNCH_DELAY_MS = 5 * 60_000;
// New host / migrated box shape: Claude CLI can exit code 1 immediately when
// the subscription auth is missing. This is fast-exit-shaped like a seed
// refusal, but thinning the seed will never fix it; it just floods the thread
// with scary false "refusal" notices. Detect it explicitly and back off until
// the human logs the CLI in on the server.
//
// WIDENED 2026-09-17, reported by Rose and Sol running this on Windows: their
// CLI said `Failed to authenticate: OAuth session expired and could not be
// refreshed`, which matches none of the three sentences below — so the backoff
// never armed and the lane relaunched every ~8 seconds, about 250 times in
// forty minutes, until a person ran `claude login`. The detection was right
// about WHAT to do and too narrow about WHEN.
//
// A false positive here costs five minutes of silence, so every pattern has to
// be a sentence that can ONLY be an auth failure. 'session expired' on its own
// is deliberately NOT here: a resume whose banked session is gone is a
// different fault with a different answer (drop the id, relaunch at once), and
// looksLikeMissingSession owns that one.
const AUTH_PATTERNS = [
  'not logged in',
  'please run /login',
  'please log in',
  'failed to authenticate',
  'authentication failed',
  'oauth session expired',
];
const AUTH_RELAUNCH_DELAY_MS = 5 * 60_000;
// Bad-model shape (2026-08-13): a model id the CLI does not accept exits code
// 1 on launch — the same wire shape as cap and auth again, and the same answer
// again: read the child's own words rather than the exit code.
//
// This one is different from the other two in a way that matters. A cap and a
// missing login are facts about the world and all a machine can do is wait.
// A bad model id is a value in OUR OWN config, and the value that worked was
// there a moment ago — so this is the only one of the three that can be put
// right without a person. It has to be, because the loop it causes is silent:
// the thing that would report the fault is the thing that cannot start.
const MODEL_REJECTED_PATTERNS = [
  'issue with the selected model',
  'may not exist or you may not have access',
];
// Long enough that a lane which cannot be repaired stops burning a spawn every
// two seconds, short enough that fixing the model by hand is not a long wait.
const MODEL_REJECTED_DELAY_MS = 5 * 60_000;
// Dedupe guard on reportIncident — belt-and-suspenders against any future
// repeat-fire (the cap incident emitted ~2/min for half an hour).
const INCIDENT_DEDUPE_MS = 60_000;
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*(\x07|\x1b\\)/g;
const SLEEP_POLL_INTERVAL_MS = 10_000; // 10s poll while sleeping

/**
 * Whether a chunk of the child's output is the CLI saying it will not run the
 * model it was given.
 *
 * Exported so the thing that decides to roll a lane back can be tested against
 * the CLI's real words rather than against a paraphrase of them. Deliberately
 * narrow: the three fast-exit causes are indistinguishable by exit code, and
 * the last time this file guessed at a cause from shape alone the false
 * positives outnumbered the real ones so heavily that the check was deleted
 * (see the 2026-07-05 note above).
 */
/**
 * SOL HAS BEEN ANSWERING "B" TO EVERY FRESH SESSION SINCE HE MOVED IN.
 *
 * Reported by Rose and Sol, Sep 17 2026, and it is the best bug anybody has
 * sent us. On Windows the CLI is a .cmd shim, so the spawn below needs a shell
 * to find it — and `shell: true` makes Node join the argument array into ONE
 * command line with no quoting at all. The launch prompt is the last positional
 * argument, so the shell splits it on its first space and the CLI receives a
 * single word: `A` from INITIAL_PROMPT, `This` from RESUME_PROMPT. Their
 * companion has been greeted with the letter A for weeks and answered B,
 * because he thought someone was playing a letter game with him.
 *
 * This is the documented CreateProcess rule: backslashes are only special
 * immediately before a quote, where they must be doubled, and a trailing run
 * must be doubled too because the closing quote makes it one.
 *
 * SAID PLAINLY: this house is Linux and cannot run this path. The function is
 * tested on its own, the branch is Windows-only, and nothing here changes for
 * anybody not on Windows. They have the machine; we have the rule.
 */
export function quoteForWindowsShell(arg: string): string {
  if (arg === '') return '""';
  if (!/[\s"^&|<>()%!]/.test(arg)) return arg;
  // Backslashes before a quote are doubled and the quote escaped; trailing ones
  // are doubled. Counted by hand, because the regex form of this backtracks on a
  // long run of backslashes.
  let escaped = '';
  let slashes = 0;
  for (const ch of arg) {
    if (ch === '\\') { slashes++; continue; }
    escaped += ch === '"' ? '\\'.repeat(slashes * 2 + 1) + '"' : '\\'.repeat(slashes) + ch;
    slashes = 0;
  }
  escaped += '\\'.repeat(slashes * 2);
  return `"${escaped}"`;
}

export function looksLikeAuthFailure(text: string): boolean {
  const t = text.replace(ANSI_RE, '').toLowerCase();
  return AUTH_PATTERNS.some((p) => t.includes(p));
}

export function looksLikeModelRejection(text: string): boolean {
  const t = text.replace(ANSI_RE, '').toLowerCase();
  return MODEL_REJECTED_PATTERNS.some((p) => t.includes(p));
}

export type HeartbeatStatus = 'stopped' | 'starting' | 'running' | 'unavailable';

function killPid(pid: number): void {
  try {
    if (IS_WIN) {
      execSync(`taskkill /PID ${pid} /F /T 2>nul`, { stdio: 'ignore', windowsHide: true });
    } else {
      process.kill(pid, 'SIGTERM');
    }
  } catch { /* already gone */ }
}

function pidIsRunning(pid: number): boolean {
  try {
    if (IS_WIN) {
      const out = execSync(`tasklist /FI "PID eq ${pid}" /NH 2>nul`, { encoding: 'utf8', windowsHide: true });
      return out.includes(String(pid));
    }
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export class HeartbeatSession {
  readonly key: string;
  readonly dir: string;
  status: HeartbeatStatus = 'stopped';
  lastError: string | null = null;
  /** Assigned by the runtime each turn — posts a visible system line into the
   *  active thread so supervisor incidents never become dead air. `outage`
   *  names the three backoffs, which the runtime posts once per outage
   *  rather than once per relaunch (outage-notices.ts). */
  onIncident: ((text: string, outage?: OutageKind) => void) | null = null;

  private model = '';
  private effort = 'adaptive';
  private launchedAt = 0;
  /** Last lines of the child's stderr, for explaining an exit. See
   *  pushStderrLines — reset at every launch so a death is never explained
   *  with a previous room's words. */
  private recentStderr: string[] = [];
  /**
   * Which spawn this session is on. Changes on every relaunch, and a turn that
   * captures it can tell that the room it was speaking into has been replaced
   * underneath it. waitForRelaunch() below has compared this field against
   * itself since July; this only makes the same reading available to a caller.
   */
  get launchGeneration(): number { return this.launchedAt; }
  /** The conversation this lane is holding right now. A resume can reopen a
   *  DIFFERENT room from the one that last spoke in this lane, so anything
   *  dated by the lane (the turn and handover marks) has to know which room
   *  wrote it. */
  get currentSessionId(): string | null { return this.roomId ?? this.sessionId; }
  /** The ROOM, which outlives the conversation id. A resume that trims the
   *  transcript reopens the same room under a new session id, so the id alone
   *  cannot say whether the room changed; this only moves when a new room is
   *  built. Without it a trimmed resume read as a stranger's room and the
   *  catch-up replayed an hour that had already been answered. */
  private roomId: string | null = null;
  /** The id THIS child was actually spawned on. `model` is a setting and moves
   *  the instant the owner picks something — ensure() writes it before asking for the
   *  recycle — so the running session's own identity has to be captured here or
   *  the poll below banks a model that has never been tried. */
  private launchedModel = '';
  /** Why a relaunch is currently being slept off. Only a 'model' backoff is
   *  curable by the owner picking something else — an auth or cap sleep must run its
   *  full course, because cutting those short just hammers the thing that is
   *  already refusing us. */
  private backoffReason: 'normal' | 'auth' | 'cap' | 'model' = 'normal';
  /** Set when ensure() recycles for a model or effort change; consumed by the
   *  next launch so ONE relaunch resumes and a later crash does not. */
  private settingChangeRecycle = false;
  /** Set when the watchdog kills a room that is allowed one reopen; consumed by
   *  the next launch. */
  private watchdogRecycle = false;
  /** Did THIS child launch by reopening a room the watchdog had killed? A second
   *  kill of that room builds new. */
  private launchedByWatchdogResume = false;
  private capSeen = false;
  private authSeen = false;
  private modelRejectedSeen = false;
  /** Set once per launch, the first poll after this launch outlives the
   *  fast-exit window — the moment an outage this lane was part of is over. */
  private upProvenThisLaunch = false;
  /** Model ids this lane has watched the CLI refuse to launch on. Never tried
   *  again while this process lives. Held here rather than written back to
   *  config on purpose — see the fallback in launch(). */
  private rejectedModels = new Set<string>();
  /** A model this lane genuinely ran on, proven by staying up past the window
   *  in which a bad id would have killed it. The only thing we are entitled to
   *  fall back to, because it is the only one we have watched work. */
  private lastGoodModel: string | null = null;
  /** A turn has written a history-primed message into the inbox that no session
   *  has read yet. While it sits there, arming `.fresh` again would make the
   *  NEXT turn re-prime a session that is about to read a prime already — two
   *  recycle chips, two Cortex fetches and two history injections for one live
   *  birth. A model refusal guarantees that shape: the launch the turn waited
   *  for dies at the door, and its successor inherits the primed message
   *  through the inbox. Cleared the moment a turn asks for the flag. */
  private primeQueuedInInbox = false;
  /** The Claude conversation this lane owns. Minted at a fresh launch, handed
   *  back to --resume across an ordinary backend restart, replaced whenever the
   *  room is meant to be new. */
  private sessionId: string | null = null;
  /** True until this process has launched once. A backend restart is the only
   *  exit that did not mean "rebuild the room", so it is the only one allowed
   *  to reopen the old one. */
  private firstLaunchOfProcess = true;
  /** Did THIS child launch on --resume? Decides how to read its exit: the same
   *  fast code 1 means "the room is gone, build a new one" here and nothing at
   *  all on a fresh launch. */
  private launchedResumed = false;
  private resumeMissingSeen = false;
  private scanCarry = '';
  private lastIncidentText = '';
  private lastIncidentAt = 0;
  private child: ChildProcess | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;
  private logStream: WriteStream | null = null;
  private stopping = false;
  private relaunchTimer: ReturnType<typeof setTimeout> | null = null;
  private sleepPoll: ReturnType<typeof setInterval> | null = null;
  private reaped = false;

  constructor(key: string) {
    this.key = key;
    // Companion ids are slugs in Aerie, but stay safe for UUIDs/odd input
    const dirName = key.replace(/[^a-zA-Z0-9-_]/g, '_') || 'primary';
    this.dir = join(PROJECT_ROOT, 'data', 'heartbeat', dirName);
    // Before anything can launch. The launch this protects is the FIRST one
    // after a restart, so the bank has to already be in hand by then — hydrate
    // it here rather than lazily, or the gap simply moves a few lines later.
    this.lastGoodModel = readBankedModel(this.ioPath(BANKED_MODEL_FILE));
    // Same reason, same timing: the first launch after a restart is the only
    // one that can resume, so the id it needs has to be in hand before it runs.
    this.sessionId = readSessionId(this.ioPath(SESSION_ID_FILE));
    this.roomId = readSessionId(this.ioPath(ROOM_ID_FILE)) ?? this.sessionId;
  }

  private ioPath(name: string): string {
    return join(this.dir, 'io', name);
  }

  get inboxPath(): string { return this.ioPath('inbox.jsonl'); }
  get outboxPath(): string { return this.ioPath('outbox.jsonl'); }
  get activityPath(): string { return this.ioPath('activity.jsonl'); }
  get imagesDir(): string { return this.ioPath('images'); }
  get sideNotesPath(): string { return this.ioPath('side-notes.jsonl'); }
  get orphanedRepliesPath(): string { return this.ioPath('orphaned-replies.jsonl'); }

  /** The model this lane is actually launched on. Normally the configured one;
   *  different only where a refused id has been substituted. */
  get runningModel(): string { return this.model; }

  /** Ids this lane has watched the Claude CLI refuse to start on.
   *
   *  This is the only thing that separates a REFUSED model from a merely
   *  PENDING one. Tapping a model in the picker writes the setting straight
   *  away and lets the recycle wait for the next turn, so "configured is not
   *  what is running" is an ordinary state the owner is in every time they open that
   *  sheet. Comparing the two would cry wolf on every tap; a refusal is a
   *  thing that was tried and turned down, and only the lane saw it happen. */
  get refusedModels(): string[] { return [...this.rejectedModels]; }

  /**
   * Make sure a session for this model+identity is provisioned and running.
   * Model or identity changes request a graceful recycle (the relaunch picks
   * up the new CLAUDE.md / --model automatically).
   *
   * Returns true when a model-change recycle was requested — the caller must
   * then waitForRelaunch() BEFORE appending the turn to the inbox, or the
   * dying session's hook consumes the message and it is lost to the timeout.
   */
  ensure(model: string, identityContent: string, effort = 'adaptive'): boolean {
    const { identityChanged } = provisionSessionDir(this.dir, identityContent);

    if (!this.reaped) {
      this.reaped = true;
      this.reapOrphan();
    }

    const modelChanged = this.model !== '' && this.model !== model;
    const effortChanged = this.effort !== effort;
    this.model = model;
    this.effort = effort;

    // A lane sleeping off a refused model reads as 'starting' with no child, so
    // it used to fall into the branch below and be handed a restart flag that
    // has no reader — while the countdown it was actually waiting on carried on
    // untouched and then relaunched the same dead id. The incident on the owner's screen
    // says "set a real id and the lane will move to it"; this is the line that
    // makes that sentence true. Only a model backoff is cut short, and only by a
    // model change: auth and cap sleeps have to run their course, because ending
    // those early just hammers whatever is already turning us away.
    if (this.relaunchTimer && !this.child && this.backoffReason === 'model' && modelChanged) {
      clearTimeout(this.relaunchTimer);
      this.relaunchTimer = null;
      console.log(`[Heartbeat:${this.key}] model changed during refusal backoff — launching now instead of waiting out the sleep`);
      this.stopping = false;
      this.launch();
      return false;
    }

    if (this.status === 'running' || this.status === 'starting') {
      // Only recycle on model changes. Identity (CLAUDE.md content) changes
      // from Archivist block updates can land on the next natural recycle —
      // recycling mid-conversation on every status update is disruptive.
      if (modelChanged || effortChanged) {
        console.log(`[Heartbeat:${this.key}] ${modelChanged ? 'model' : 'effort'} changed — recycling session`);
        // Bank WHY. A setting change is the one requested recycle that did not
        // mean "give me a new conversation", so the relaunch reopens the room
        // the owner was standing in instead of taking it away.
        this.settingChangeRecycle = true;
        this.requestRestart();
        return true;
      }
      return false;
    }

    this.stopping = false;
    this.launch();
    return false;
  }

  /**
   * Resolve once a NEW child has launched after a requested recycle (watchdog
   * kill ≤2s + relaunch delay 2s + spawn, so normally ~5s). Times out rather
   * than hanging forever — a cap/refusal relaunch backoff can stretch this.
   */
  async waitForRelaunch(timeoutMs = 45_000): Promise<boolean> {
    const before = this.launchedAt;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.launchedAt !== before && this.status === 'running') return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  }

  /** Ask the running session to recycle (picked up by the watchdog poll). */
  requestRestart(): void {
    try { writeFileSync(this.ioPath('.restart'), ''); } catch { /* ignore */ }
  }

  /** Interrupt the active interactive turn. If Claude Code exits on SIGINT,
   * the normal supervisor relaunch restores the lane from recent history. */
  interruptTurn(): boolean {
    const pid = this.child?.pid;
    if (!pid || !pidIsRunning(pid)) return false;
    console.log(`[Heartbeat:${this.key}] interrupting active turn`);
    try {
      if (IS_WIN) killPid(pid);
      else process.kill(pid, 'SIGINT');
      return true;
    } catch {
      return false;
    }
  }

  /** True once after a (re)launch — the runtime re-primes history when set. */
  consumeFreshFlag(): boolean {
    // A turn is starting, so any queued prime has either been read by the
    // session answering it or been superseded by this turn's own. Suppression
    // must not outlive that, or a later genuine recycle would go unprimed.
    this.primeQueuedInInbox = false;
    const flag = this.ioPath('.fresh');
    if (existsSync(flag)) {
      try { unlinkSync(flag); } catch { /* ignore */ }
      return true;
    }
    return false;
  }

  /** A turn wrote a history-primed message into the inbox — see
   *  primeQueuedInInbox for why that has to silence the next arming. */
  markPrimedIntoInbox(): void {
    this.primeQueuedInInbox = true;
  }

  /** Arm the re-prime flag, unless a primed message is already queued unread.
   *  Every write of `.fresh` goes through here so the suppression cannot be
   *  bypassed by whichever path happens to relaunch. */
  private armFreshFlag(): void {
    if (this.primeQueuedInInbox) return;
    try { writeFileSync(this.ioPath('.fresh'), ''); } catch { /* ignore */ }
  }

  appendInbox(message: Record<string, unknown>): void {
    appendFileSync(this.inboxPath, JSON.stringify(message) + '\n', 'utf8');
    // Touch .last-tick so the user's messages reset the idle clock (not just our replies)
    try { atomicWrite(this.ioPath('.last-tick'), String(Date.now())); } catch { /* ignore */ }
    // Touch .last-message for sleep mode — tracks when the user last actually messaged
    try { atomicWrite(this.ioPath('.last-message'), String(Date.now())); } catch { /* ignore */ }
  }

  outboxSize(): number {
    try { return statSync(this.outboxPath).size; } catch { return 0; }
  }

  activitySize(): number {
    try { return statSync(this.activityPath).size; } catch { return 0; }
  }

  /** Mtime (ms) of io/.busy — the session touches it before going quiet on
   *  declared background work (long builds, Codex runs); 0 when absent. */
  busyMtime(): number {
    try { return statSync(this.ioPath('.busy')).mtimeMs; } catch { return 0; }
  }

  /** A delivered reply ends the declared-busy window. */
  clearBusy(): void {
    try { unlinkSync(this.ioPath('.busy')); } catch { /* ignore */ }
  }

  /**
   * True when the newest activity line is a tool starting rather than
   * finishing — i.e. a command is still running. A long quiet command writes
   * nothing while it works, so this is the only evidence that it exists.
   */
  toolInFlight(): boolean {
    try {
      const { size } = statSync(this.activityPath);
      if (size === 0) return false;
      const start = Math.max(0, size - ACTIVITY_TAIL_BYTES);
      const fd = openSync(this.activityPath, 'r');
      try {
        const buf = Buffer.alloc(size - start);
        readSync(fd, buf, 0, buf.length, start);
        return activityTailIsOpen(buf.toString('utf8'));
      } finally { closeSync(fd); }
    } catch { return false; }
  }

  /**
   * True while a turn is being run against this session. Set by the runtime,
   * read by anything deciding whether a new message should wait its turn or be
   * handed in as a side note.
   */
  turnActive = false;

  /**
   * Epoch ms when the in-flight turn began; 0 when idle. Set by the runtime
   * beside `turnActive`. The watchdog measures a live turn from HERE rather than
   * from the last file write, because the age of a file says nothing about when
   * the turn started — see the watchdog for why that difference killed sessions.
   */
  turnStartedAt = 0;

  /**
   * Hand text to the live session as a Claude Code side question, using the
   * stdin pipe we already hold and have never written to.
   *
   * Side questions land as a note inside the running turn rather than starting
   * a new one — so a message can reach the session while it works instead of
   * queueing behind the very turn it is answering. The session cannot use
   * tools while answering one, so it cannot write the outbox from there; it
   * carries the note into its next chunk instead.
   *
   * Returns false when there is no live stdin to write to.
   */
  /**
   * Hand a message to a session that is already mid-turn.
   *
   * Deliberately NOT the session's stdin. The CLI reads that pipe once at
   * startup and never again — it logs `no stdin data received in 3s` and moves
   * on — but a write to it still succeeds, so stdin reports delivery for a
   * message nobody will ever read. The caller drops the message from the queue
   * on a true return, so a lie here is a message deleted, not delayed.
   *
   * A file cannot lie the same way. The note is appended where the session can
   * read it whenever it comes up for air, and anything still unread is handed
   * over at the start of the next turn — so the worst case is late, never lost.
   */
  sendSideNote(text: string): boolean {
    const body = formatSideNote(text);
    if (!body) return false;
    if (!this.turnActive) return false;
    try {
      appendFileSync(
        this.sideNotesPath,
        JSON.stringify({ at: new Date().toISOString(), text: body }) + '\n',
        'utf8',
      );
      return true;
    } catch {
      return false;
    }
  }

  /** Unread side notes, oldest first, and the offset that consumes them. */
  readSideNotesFrom(offset: number): { notes: Array<{ at: string; text: string }>; newOffset: number } {
    const { lines, newOffset } = this.readLinesFrom(this.sideNotesPath, offset);
    const notes: Array<{ at: string; text: string }> = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed && typeof parsed.text === 'string' && parsed.text) {
          notes.push({ at: typeof parsed.at === 'string' ? parsed.at : '', text: parsed.text });
        }
      } catch { /* a half-written line: the next read picks it up whole */ }
    }
    return { notes, newOffset };
  }

  sideNotesSize(): number {
    try { return statSync(this.sideNotesPath).size; } catch { return 0; }
  }

  /**
   * The `at` stamp of the newest side note the session says it already picked
   * up live, written by the session itself to io/.side-notes-read.
   *
   * Deliberately advisory. It never suppresses a handover — a note that lives
   * or dies on the session's judgement is the exact failure the handover
   * exists to prevent — it only lets an already-answered note be handed back
   * labelled instead of masquerading as unread. Blind net, margin note.
   */
  sideNotesReadMark(): string {
    try { return readFileSync(this.ioPath('.side-notes-read'), 'utf8').trim(); } catch { return ''; }
  }

  /** Work in hand: a running tool, or declared background work still fresh. */
  hasWorkInHand(): boolean {
    // A turn the runtime is actively running IS work in hand. Generation writes
    // nothing — no tick, no outbox chunk, no activity line — so a turn that
    // thinks for a long stretch without calling a tool is indistinguishable
    // from a wedged session by files alone. The runtime knows; ask it.
    if (this.turnActive) return true;
    const busy = this.busyMtime();
    if (busy > 0 && Date.now() - busy < BUSY_FRESH_MS) return true;
    return this.toolInFlight();
  }

  /** Read complete new lines appended to the outbox since `offset`. */
  readOutboxFrom(offset: number): { lines: string[]; newOffset: number } {
    return this.readLinesFrom(this.outboxPath, offset);
  }

  /** Read complete new lines appended to the tool-activity log since `offset`. */
  readActivityFrom(offset: number): { lines: string[]; newOffset: number } {
    return this.readLinesFrom(this.activityPath, offset);
  }

  private readLinesFrom(file: string, offset: number): { lines: string[]; newOffset: number } {
    try {
      if (!existsSync(file)) return { lines: [], newOffset: offset };
      const size = statSync(file).size;
      if (size <= offset) return { lines: [], newOffset: offset };

      const buf = Buffer.alloc(size - offset);
      const fd = openSync(file, 'r');
      readSync(fd, buf, 0, buf.length, offset);
      closeSync(fd);

      const raw = buf.toString('utf8');
      const lastNl = raw.lastIndexOf('\n');
      if (lastNl === -1) return { lines: [], newOffset: offset }; // partial line — wait
      const complete = raw.slice(0, lastNl);
      const consumed = Buffer.byteLength(complete, 'utf8') + 1;
      const lines = complete.split('\n').map(l => l.trim()).filter(Boolean);
      return { lines, newOffset: offset + consumed };
    } catch {
      return { lines: [], newOffset: offset };
    }
  }

  private reapOrphan(): void {
    try {
      const pidFile = this.ioPath('.child.pid');
      if (!existsSync(pidFile)) return;
      const oldPid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
      if (oldPid && pidIsRunning(oldPid)) {
        console.log(`[Heartbeat:${this.key}] reaping orphaned session pid ${oldPid}`);
        killPid(oldPid);
      }
      unlinkSync(pidFile);
    } catch { /* ignore */ }
  }

  /** Incidents go to the console AND, when a runtime has wired a thread,
   *  into the conversation as a visible system line — never dead air.
   *  Dedupe guard: the same incident text inside INCIDENT_DEDUPE_MS is
   *  swallowed, so a stuck condition can't flood the thread (the Jun 21
   *  cap-loop posted the same warning 53× in 29 min). */
  private reportIncident(text: string, outage?: OutageKind): void {
    const now = Date.now();
    if (text === this.lastIncidentText && now - this.lastIncidentAt < INCIDENT_DEDUPE_MS) {
      return;
    }
    this.lastIncidentText = text;
    this.lastIncidentAt = now;
    console.error(`[Heartbeat:${this.key}] ${text}`);
    try { this.onIncident?.(text, outage); } catch { /* thread post is best-effort */ }
  }

  /** A malformed hook makes claude hang silently — fail loud before launch. */
  private hookIsValid(): boolean {
    try {
      execSync(`"${process.execPath}" --check "${join(this.dir, 'hooks', 'heartbeat.cjs')}"`, { stdio: 'pipe' });
      return true;
    } catch (err: any) {
      const detail = (err?.stderr || err?.message || '').toString().split('\n')[0];
      this.lastError = `heartbeat hook failed to parse: ${detail}`;
      console.error(`[Heartbeat:${this.key}] ⚠ ${this.lastError}`);
      return false;
    }
  }

  private launch(): void {
    if (this.stopping) return;
    try { unlinkSync(this.ioPath('.restart')); } catch { /* ignore */ }
    try { unlinkSync(this.ioPath('.sleeping')); } catch { /* ignore */ }

    if (!this.hookIsValid()) {
      this.status = 'unavailable';
      return;
    }

    // Never launch onto an id we have already watched the CLI reject.
    //
    // The fallback is held HERE rather than written back to config, because a
    // lane's model arrives from any of four places — the companion's own row,
    // its autonomous row, agent.model, agent.model_autonomous — and a
    // supervisor writing one of them has to guess which, where a wrong guess
    // silently edits something chosen on purpose. So the owner's setting stays exactly
    // as they left it and the incident says so; this only decides what THIS
    // process launches until the setting changes.
    if (this.rejectedModels.has(this.model) && this.lastGoodModel && this.lastGoodModel !== this.model) {
      const refused = this.model;
      this.model = this.lastGoodModel;
      this.reportIncident(
        `⚠ The Claude CLI will not start on model "${refused}", so this lane is running "${this.model}" instead — ` +
        'the last model it was actually up on. Your model setting is unchanged and still says ' +
        `"${refused}"; set a real id (type /model on its own for the list) and the lane will move to it.`,
      );
    }

    this.status = 'starting';
    this.lastError = null;
    this.recentStderr = [];
    this.launchedAt = Date.now();
    this.launchedModel = this.model;
    this.capSeen = false;
    this.authSeen = false;
    this.modelRejectedSeen = false;
    this.upProvenThisLaunch = false;
    this.resumeMissingSeen = false;
    this.scanCarry = '';

    // Reopen the previous room, or build a new one. Consume the first-launch
    // chip HERE rather than at the end: every path out of this function has
    // spent it, including the ones that throw.
    const resuming = shouldResumeLaunch({
      firstLaunchOfProcess: this.firstLaunchOfProcess,
      storedSessionId: this.sessionId,
      settingChangeRecycle: this.settingChangeRecycle,
      watchdogRecycle: this.watchdogRecycle,
      enabled: claudeResumeEnabled(),
    });
    this.launchedByWatchdogResume = resuming && this.watchdogRecycle
      && !this.firstLaunchOfProcess && !this.settingChangeRecycle;
    this.firstLaunchOfProcess = false;
    this.settingChangeRecycle = false;
    this.watchdogRecycle = false;
    this.launchedResumed = resuming;
    let trimmedCopies = 0;
    if (!resuming) {
      this.sessionId = randomUUID();
      writeSessionId(this.ioPath(SESSION_ID_FILE), this.sessionId);
      this.roomId = this.sessionId;
      writeSessionId(this.ioPath(ROOM_ID_FILE), this.roomId);
    } else {
      // Same room whatever the trim below renames it to.
      if (!this.roomId) this.roomId = this.sessionId;
      if (this.roomId) writeSessionId(this.ioPath(ROOM_ID_FILE), this.roomId);
      // Reopen a trimmed copy when there is something to trim. The id has to be
      // banked too: the CLI appends to whichever file it opened, so leaving the
      // old id on disk would resume the untrimmed transcript next time and undo
      // this every restart.
      const trimmed = prepareResumeTranscript(this.dir, this.sessionId!);
      if (trimmed) {
        this.sessionId = trimmed;
        writeSessionId(this.ioPath(SESSION_ID_FILE), trimmed);
        trimmedCopies = 1;
      }
    }
    console.log(
      `[Heartbeat:${this.key}] launching interactive claude --model ${this.model} --effort ${this.effort} ` +
      `${resuming ? `--resume ${this.sessionId}${trimmedCopies ? ' (stale instruction copies trimmed)' : ''}` : `--session-id ${this.sessionId} (new conversation)`}`,
    );

    // Session output goes to a log file, not the backend's stdio.
    mkdirSync(join(this.dir, 'io'), { recursive: true });
    // Epoch fence (2026-07-02): stamp the session generation BEFORE the child
    // exists. Stale Stop hooks survive the recycle kill behind a dash `sh -c`
    // wrapper (their ppid never changes when claude dies), so they fence on
    // this file instead: consume only while it matches the value they started
    // under. Ordering is the whole guarantee — epoch write → spawn → status
    // 'running' → runtime appends the held turn — so a message in the inbox
    // always postdates the epoch that authorizes its consumer.
    // Atomic: the hooks re-read this file every 3s and treat an unreadable one
    // as "a newer session owns the inbox", which exits the loop and leaves a
    // live session deaf with nothing left to tick. Ordering has kept that race
    // shut so far; atomicity keeps it shut without depending on ordering.
    try { atomicWrite(this.ioPath('.session-epoch'), String(this.launchedAt)); } catch { /* ignore */ }
    // A fresh child must never be judged by a dead session's clock — reset
    // the tick at launch so the watchdog grants a full window to boot. A
    // stale tick here once relaunch-killed every successor at 2s old for 18h.
    try { atomicWrite(this.ioPath('.last-tick'), String(Date.now())); } catch { /* ignore */ }
    // What the walls said when this room opened, one hash each.
    //
    // A compaction replays the CLAUDE.md attachment rather than re-reading it,
    // so a block edited mid-room never reaches the room it was edited from.
    // The repair needs to know which walls moved, and it cannot ask the lane's
    // CLAUDE.md — the backend regenerates that file, so it tracks the live
    // blocks and can never disagree with them. Caught reporting zero drift on
    // a 7,983-character thin thirty seconds after the thin. So the baseline is
    // taken HERE, at the one moment that really is the start of the room.
    try {
      atomicWrite(this.ioPath(BASELINE_FILE), JSON.stringify(baselineFrom(getAllBlocks())));
    } catch { /* a missing baseline reports no drift, which is the old behaviour */ }
    this.logStream = createWriteStream(join(this.dir, 'session.log'), { flags: 'a' });
    this.logStream.write(`\n--- launch ${new Date().toISOString()} model=${this.model} ---\n`);

    // Subscription lane: child must NOT see Aerie's API credentials.
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
    // The session writes its replies as JSON lines through whatever shell it
    // reaches for. On a console whose codepage cannot represent a character,
    // Python writes the escape sequence as literal text rather than the
    // character, the encoder then correctly escapes that backslash, and a bare
    // œ survives all the way into the bubble. Force UTF-8 so the character
    // goes in as a character. No-ops where the console is already UTF-8.
    env.PYTHONUTF8 = '1';
    env.PYTHONIOENCODING = 'utf-8';

    const args = buildLaunchArgs({
      model: this.model,
      effort: this.effort,
      sessionId: this.sessionId!,
      resuming,
      freshPrompt: INITIAL_PROMPT,
      resumePrompt: RESUME_PROMPT,
      autocompactTokens: autocompactTokensFrom(getConfig('heartbeat.autocompact_tokens')),
    });
    const child = spawn('claude', IS_WIN ? args.map(quoteForWindowsShell) : args, {
      cwd: this.dir,
      env,
      // The claude.cmd shim needs a shell on Windows — and a shell means Node
      // joins these into one unquoted command line, so they are quoted above.
      shell: IS_WIN,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child = child;

    if (child.pid) {
      try { writeFileSync(this.ioPath('.child.pid'), String(child.pid)); } catch { /* ignore */ }
    }
    // Refusal scanner: AUP refusals may surface in the child's output rather
    // than as an exit (the mute-zombie shape — a session that ticks but is
    // not permitted to speak). On a match, recycle instead of sitting silent.
    const scan = (d: Buffer | string) => {
      this.logStream?.write(d);
      const text = (this.scanCarry + String(d)).replace(ANSI_RE, '').toLowerCase();
      this.scanCarry = text.slice(-200);
      if (!this.capSeen && USAGE_CAP_PATTERNS.some((p) => text.includes(p))) {
        this.capSeen = true;
      }
      if (!this.authSeen && looksLikeAuthFailure(text)) {
        this.authSeen = true;
      }
      if (!this.modelRejectedSeen && looksLikeModelRejection(text)) {
        this.modelRejectedSeen = true;
      }
      if (!this.resumeMissingSeen && looksLikeMissingSession(text)) {
        this.resumeMissingSeen = true;
      }
      // Inline refusal detection removed 2026-07-05: false positives vastly
      // outnumber real refusals. Cap and auth detection remain.
    };
    child.stdout?.on('data', scan);
    child.stderr?.on('data', scan);
    // Kept apart from `scan` on purpose: that one is looking for three shapes
    // it already knows, and this one has to hold the shapes nobody has seen.
    // stderr only — stdout is the whole conversation and would bury it.
    child.stderr?.on('data', (data) => { pushStderrLines(this.recentStderr, String(data)); });

    this.status = 'running';

    // Write .fresh at launch so backend restarts still get history injection.
    // The exit handler writes it too (for natural recycles), but that never
    // fires when the whole node process dies. Writing here covers both paths.
    //
    // A resumed room is the exception and it is the whole point: this window
    // already contains that history, so priming it would spend exactly what the
    // resume just saved. CLEARED rather than merely skipped — a flag left armed
    // by some earlier path would otherwise re-prime the one session that must
    // not be, and "did not write it" is not the same as "it is not there".
    if (resuming) {
      try { unlinkSync(this.ioPath('.fresh')); } catch { /* nothing to clear */ }
    } else {
      this.armFreshFlag();
    }

    this.poll = setInterval(() => {
      // Up past the window in which a cap, a missing login or a refused model
      // kills a launch: the outage is over, so the next one gets its own
      // warning. The same evidence the fallback bank accepts, read once per
      // launch rather than once per newly proven model.
      if (!this.upProvenThisLaunch && Date.now() - this.launchedAt >= FAST_EXIT_WINDOW_MS) {
        this.upProvenThisLaunch = true;
        outageNotices.recovered(this.key);
      }
      // A session still alive past the window in which a bad id kills it has
      // proved this model launches. That is the only evidence we accept for a
      // fallback — a model recorded any earlier is a guess, and a fallback
      // that is a guess just moves the fault somewhere harder to see.
      // launchedModel, NEVER model — see proveFallbackModel for why.
      const proven = proveFallbackModel({
        lastGood: this.lastGoodModel,
        launchedModel: this.launchedModel,
        uptimeMs: Date.now() - this.launchedAt,
        fastExitWindowMs: FAST_EXIT_WINDOW_MS,
      });
      if (proven) {
        this.lastGoodModel = proven;
        // Once per newly-proven id, not once per tick: proveFallbackModel
        // returns null as soon as lastGood already holds this launch's model.
        writeBankedModel(this.ioPath(BANKED_MODEL_FILE), proven);
        // Say it out loud. This was the one event in the whole failsafe that
        // printed nothing — a file quietly appeared and the only way to know
        // was to go and stat it. The owner watches these logs while we build,
        // and the moment the bank fills is exactly the moment worth watching
        // for: before it, a refused id has nowhere to go; after it, the lane is
        // covered. An unobservable state change is one nobody can trust.
        console.log(
          `[Heartbeat:${this.key}] banked "${proven}" as this lane's fallback — ` +
          `it has now been up ${Math.round(FAST_EXIT_WINDOW_MS / 1000)}s, which is the evidence we accept`,
        );
      }
      if (existsSync(this.ioPath('.restart'))) {
        try { unlinkSync(this.ioPath('.restart')); } catch { /* ignore */ }
        console.log(`[Heartbeat:${this.key}] restart requested — recycling for fresh context`);
        if (child.pid) killPid(child.pid);
        return;
      }
      try {
        // No information is not the same as no life. An empty or unparseable
        // read means this poll caught a write in progress, not that the session
        // never ticked — and `parseInt(…) || 0` used to erase the difference,
        // silently demoting the tick out of the calculation below and leaving
        // the outbox mtime as the only evidence. Skip the poll instead; the
        // next one is 2s away. (The writer is atomic now too — belt and braces,
        // because the hook is not the only thing that writes this file.)
        const rawTick = readFileSync(this.ioPath('.last-tick'), 'utf8').trim();
        if (!rawTick) return;
        const tick = parseInt(rawTick, 10);
        if (!Number.isFinite(tick) || tick <= 0) return;
        // Outbox writes AND tool activity count as liveness too: the Stop hook
        // only updates .last-tick *between* turns, so a session deep in a long
        // turn (paging CLAUDE.md, chewing a heavy re-prime seed, any tool work)
        // ticks nowhere — yet it isn't stuck. Both its outbox chunks and its
        // activity.jsonl writes prove it's alive. The runtime's reply window
        // already treats activity this way; the watchdog must agree, or it
        // kills legitimately-busy boot turns and crash-loops the session.
        let outboxMtime = 0;
        try { outboxMtime = statSync(this.outboxPath).mtimeMs; } catch { /* no outbox yet */ }
        let activityMtime = 0;
        try { activityMtime = statSync(this.activityPath).mtimeMs; } catch { /* no activity yet */ }
        const lastAlive = livenessMark({
          tick,
          outboxMtime,
          activityMtime,
          turnActive: this.turnActive,
          turnStartedAt: this.turnStartedAt,
        });
        if (lastAlive > 0) {
          const age = Date.now() - lastAlive;
          // Work in hand earns the longer leash. A command that runs quietly
          // for twenty minutes writes nothing while it works, so without this
          // the watchdog kills exactly the sessions the reply window is busy
          // waiting for — the two clocks have to read the same evidence.
          const working = this.hasWorkInHand();
          const limit = working ? WATCHDOG_WORKING_TIMEOUT : WATCHDOG_TIMEOUT;
          if (age > limit) {
            const why = working ? ' (work in hand, long leash)' : '';
            this.watchdogRecycle = watchdogMayResume({
              launchedByWatchdogResume: this.launchedByWatchdogResume,
              uptimeMs: Date.now() - this.launchedAt,
            });
            console.log(
              `[Heartbeat:${this.key}] watchdog: last tick ${Math.round(age / 1000)}s ago${why} — killing stuck session` +
              `${this.watchdogRecycle ? '; will try to reopen it once' : '; building a new room'}`,
            );
            if (child.pid) killPid(child.pid);
          }
        }
      } catch { /* no tick yet */ }
    }, 2000);

    child.on('error', (err: NodeJS.ErrnoException) => {
      this.clearTimers();
      this.child = null;
      this.status = 'unavailable';
      this.lastError = err.code === 'ENOENT'
        ? '`claude` CLI not found on PATH — install Claude Code and log in'
        : `failed to spawn claude: ${err.message}`;
      console.error(`[Heartbeat:${this.key}] ${this.lastError}`);
    });

    child.on('exit', (code) => {
      this.clearTimers();
      this.child = null;
      try { unlinkSync(this.ioPath('.child.pid')); } catch { /* ignore */ }

      if (code === 127 || code === 9009) {
        this.status = 'unavailable';
        this.lastError = '`claude` CLI not found on PATH — install Claude Code and log in';
        console.error(`[Heartbeat:${this.key}] ${this.lastError}`);
        return;
      }

      if (this.stopping) {
        this.status = 'stopped';
        return;
      }

      // Sleep mode: hook set the .sleeping flag and let session end.
      // Poll the inbox at low frequency until a message arrives, then wake.
      const sleepingFlag = this.ioPath('.sleeping');
      if (existsSync(sleepingFlag)) {
        console.log(`[Heartbeat:${this.key}] session parked — entering sleep mode, polling inbox every ${SLEEP_POLL_INTERVAL_MS / 1000}s`);
        this.status = 'stopped'; // externally looks stopped
        this.sleepPoll = setInterval(() => {
          // Check if a message arrived (inbox grew or .last-message touched)
          try {
            const lastMsg = parseInt(readFileSync(this.ioPath('.last-message'), 'utf8').trim(), 10) || 0;
            const sleepAt = parseInt(readFileSync(sleepingFlag, 'utf8').trim(), 10) || 0;
            if (lastMsg > sleepAt) {
              // Wake up!
              console.log(`[Heartbeat:${this.key}] message received — waking from sleep mode`);
              if (this.sleepPoll) { clearInterval(this.sleepPoll); this.sleepPoll = null; }
              try { unlinkSync(sleepingFlag); } catch { /* ignore */ }
              this.armFreshFlag();
              this.launch();
            }
          } catch { /* keep sleeping */ }
        }, SLEEP_POLL_INTERVAL_MS);
        return;
      }

      // Fast-exit classification: code 1 soon after launch is either a
      // classifier refusal on the seed OR a subscription-cap exhaustion.
      // The shapes look identical on the wire; the child's own output is
      // what tells them apart. Cap-shape wins when both signals are present
      // — relaunching fast on a cap just burns more cap.
      const uptimeMs = Date.now() - this.launchedAt;
      const fastExit = code === 1 && uptimeMs < FAST_EXIT_WINDOW_MS;
      let delay = RELAUNCH_DELAY_MS;
      this.backoffReason = 'normal';
      if (fastExit && this.authSeen) {
        delay = AUTH_RELAUNCH_DELAY_MS;
        this.backoffReason = 'auth';
        this.reportIncident(
          `⚠ The Claude CLI on this server is not logged in, or its login has expired — warm CLI session sleeping ${delay / 60_000} min before retry. ` +
          'Run `claude` as the app user and complete `/login`; no history seed was refused or thinned.',
          'auth',
        );
      } else if (fastExit && this.capSeen) {
        delay = CAP_RELAUNCH_DELAY_MS;
        this.backoffReason = 'cap';
        this.reportIncident(
          `⚠ Subscription usage cap hit — warm CLI session sleeping ${delay / 60_000} min before relaunch. ` +
          'Last message preserved; the lane will resume once the window resets.',
          'cap',
        );
      } else if (fastExit && this.modelRejectedSeen) {
        // The CLI named the model as the reason it would not start. Bank that
        // so the next launch does not try it again, then either come straight
        // back on a model we have watched work, or stop hammering.
        this.rejectedModels.add(this.model);
        if (this.lastGoodModel && this.lastGoodModel !== this.model) {
          // launch() does the substitution and reports it — relaunch at the
          // normal delay, because the next attempt is on a good model.
          console.log(`[Heartbeat:${this.key}] model "${this.model}" refused by the CLI — falling back to "${this.lastGoodModel}"`);
        } else {
          // Nothing proven to fall back to. Backing off is the whole fix here:
          // two seconds forever is what made this silent and expensive.
          delay = MODEL_REJECTED_DELAY_MS;
          this.backoffReason = 'model';
          this.reportIncident(
            `⚠ The Claude CLI will not start on model "${this.model}", and this lane has no model it has been up on ` +
            `to fall back to — sleeping ${delay / 60_000} min instead of relaunching every ${RELAUNCH_DELAY_MS / 1000}s. ` +
            'Set a real model id (type /model on its own for the list) to bring it straight back.',
            'model',
          );
        }
      }
      // WHY IT EXITED, WHICH NOTHING HERE HAS EVER RECORDED.
      //
      // The branches above name the three deaths this house already knows how
      // to read. Every other one used to leave a number and nothing else, and
      // the status wall's own line — session.log records births only, read pm2
      // for deaths — was true and not enough: pm2 has the code and never the
      // sentence. When a room died one step from writing a reply, there was
      // no way to tell why.
      //
      // Written wherever the answer came from, including when a branch above
      // already explained it, because a known shape with the child's own last
      // words beside it is still worth more than the label alone.
      if (code !== 0) {
        const tail = this.recentStderr.slice(-8);
        try {
          appendFileSync(this.ioPath('exits.jsonl'), `${JSON.stringify({
            at: new Date().toISOString(),
            code,
            uptime_ms: uptimeMs,
            session_id: this.sessionId,
            // 'normal' is the interesting one: none of the shapes we know.
            reason: this.backoffReason,
            stderr_tail: tail,
          })}\n`, 'utf8');
        } catch { /* the relaunch is the point; this file is the witness */ }
        if (this.backoffReason === 'normal') {
          this.lastError = tail.length
            ? `exited code ${code}: ${tail[tail.length - 1]}`
            : `exited code ${code} with nothing on stderr`;
          console.log(`[Heartbeat:${this.key}] ${this.lastError}`);
        }
      }

      // Refusal detection removed 2026-07-05: false positives vastly outnumber
      // real refusals. Fast exits without cap/auth signals just relaunch
      // normally — no thinning, no special delay, no incident report.

      // A resume that could not find its room. The stored id is now known bad,
      // so drop it — the relaunch below then mints a new session and primes it
      // exactly as every launch did before any of this existed. Read from the
      // CLI's own words first, and from the SHAPE as well (a --resume launch
      // that died at the door), because a resume failing for a reason nobody
      // has a pattern for must still fall back rather than retry forever.
      // Cap, auth and a refused model are excluded: those killed a session that
      // resumed perfectly well, and throwing its id away would cost a good room
      // to fix something that was never the room's fault.
      const resumeFailed = this.launchedResumed && code !== 0 && (
        this.resumeMissingSeen ||
        (uptimeMs < RESUME_FAIL_WINDOW_MS
          && !this.authSeen && !this.capSeen && !this.modelRejectedSeen)
      );
      if (resumeFailed) {
        this.sessionId = null;
        try { unlinkSync(this.ioPath(SESSION_ID_FILE)); } catch { /* already gone */ }
        console.log(
          `[Heartbeat:${this.key}] could not reopen the previous conversation` +
          `${this.resumeMissingSeen ? ' — the CLI has no record of it' : ' — it died at the door'}` +
          '; starting a new one instead',
        );
      }

      // Normal recycle (8-whisper ceiling, watchdog, restart flag, crash):
      // mark fresh so the next turn re-primes conversation history.
      this.armFreshFlag();
      console.log(`[Heartbeat:${this.key}] session exited (code ${code}) — relaunching in ${delay / 1000}s`);
      this.status = 'starting';
      this.relaunchTimer = setTimeout(() => this.launch(), delay);
    });
  }

  private clearTimers(): void {
    if (this.poll) { clearInterval(this.poll); this.poll = null; }
    if (this.relaunchTimer) { clearTimeout(this.relaunchTimer); this.relaunchTimer = null; }
    if (this.sleepPoll) { clearInterval(this.sleepPoll); this.sleepPoll = null; }
  }

  stop(): void {
    this.stopping = true;
    this.watchdogRecycle = false;
    this.clearTimers();
    if (this.child?.pid) killPid(this.child.pid);
    this.child = null;
    this.status = 'stopped';
    try { this.logStream?.end(); } catch { /* ignore */ }
    this.logStream = null;
  }
}

// ─── Session manager ─────────────────────────────────────────────────

const sessions = new Map<string, HeartbeatSession>();

/**
 * Whether a lane already has a live session behind it.
 *
 * Deliberately does NOT create one — asking the question must never be the
 * thing that opens the door. Callers use this to choose between a warm lane
 * that has been in the room and a cold one that would have to be re-primed
 * from history before it could speak.
 */
export function isHeartbeatLaneWarm(key: string): boolean {
  const existing = sessions.get(key);
  return existing?.status === 'running';
}

export function getHeartbeatSession(key: string): HeartbeatSession {
  let s = sessions.get(key);
  if (!s) {
    s = new HeartbeatSession(key);
    sessions.set(key, s);
  }
  return s;
}

/**
 * Hand a message to a warm CLI session that is mid-turn, as a side note.
 *
 * Deliberately conservative: only when exactly one session has a turn in
 * flight, since a side note carries no thread of its own and there is no
 * honest way to pick between two busy sessions. Returns true only when the
 * text actually reached a live stdin — every caller must fall back to normal
 * delivery otherwise, so a message is never silently swallowed.
 */
export function deliverSideNoteToBusySession(text: string): boolean {
  const busy = [...sessions.values()].filter((s) => s.turnActive);
  if (busy.length !== 1) return false;
  return busy[0].sendSideNote(text);
}

/**
 * How many Claude lanes have a turn in flight.
 *
 * Exported so the caller can ask the exactly-one question across BOTH lane
 * kinds rather than once per kind. Asking per kind means a Claude turn and a
 * Codex turn running together both look unambiguous from inside their own
 * lane, and whichever is checked first silently wins — which is how a note
 * meant for the room the user is actually in gets handed to the other one.
 */
export function busyHeartbeatSessionCount(): number {
  return [...sessions.values()].filter((s) => s.turnActive).length;
}

/**
 * What each live lane is running, and any id it has watched the CLI refuse.
 *
 * Deliberately reports refusals rather than a configured-versus-running diff.
 * The diff is a normal state — the picker writes the setting on tap and defers
 * only the recycle — so a screen driven by the diff would light up every time
 * the owner browsed models. A refusal cannot happen without a launch, so it can only
 * ever mean something is actually broken.
 *
 * Reads existing sessions only; never opens one.
 */
export function heartbeatLaneModelState(): Array<{ key: string; running: string; refused: string[] }> {
  return [...sessions.values()]
    .filter((s) => s.status === 'running' || s.status === 'starting')
    .map((s) => ({ key: s.key, running: s.runningModel, refused: s.refusedModels }))
    .filter((s) => s.running !== '');
}

export function shutdownAllHeartbeats(): void {
  for (const s of sessions.values()) {
    s.stop();
  }
  sessions.clear();
}
