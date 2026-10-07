// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * Interactive CLI runtime — the subscription-billed Claude lane.
 *
 * Bridges Aerie's turn-based AgentRuntime interface onto a warm interactive
 * Claude Code session kept alive by the heartbeat supervisor. A turn is:
 * append the message to the session's inbox, wait for the matching reply
 * line in its outbox, emit it as one text delta.
 *
 * Replies arrive whole or in coarse chunks (no token streaming) — the trade
 * for flat-rate billing. A non-final chunk line carries `more: true`; each
 * chunk re-arms the reply window, so an ack-first session can work long past
 * the base timeout, and each one closes as its own message (message_break) so
 * mid-turn words reach the room instead of waiting for the turn to end. Turns that still time out are ledgered and their late
 * replies delivered at the start of the next turn instead of dropped.
 * The session itself holds conversation memory while warm; after a recycle
 * (~hourly when idle) we re-prime with recent thread history.
 */

import type { TurnAudience } from '../turn-audience.js';
import { writeFileSync, existsSync, readFileSync, readdirSync, statSync, appendFileSync, renameSync, unlinkSync } from 'fs';
import { join } from 'path';
import { createHash, randomUUID } from 'crypto';
import { homedir } from 'os';
import type {
  AgentRuntime,
  AgentRuntimeEvent,
  RuntimeTurnInput,
  RuntimeCapabilities,
} from '../runtimes/types.js';
import { getFile, saveFile, ensureFilesDir } from '../files.js';
import type { ConversationMessage, HistoryLoader } from '../runtimes/api-router.js';
import { getHeartbeatSession, type HeartbeatSession } from './supervisor.js';
import { parseOutboxLine } from './outbox-line.js';
import { projectKeyForDir, readSessionUsage } from '../agent/session-list.js';
import { isArchiveRecord } from '../archive-artifact.js';

import { getAerieConfig, PROJECT_ROOT } from '../../config.js';
import { localClock12, localDateFull, localStamp } from '../time.js';
import { createMessage } from '../db.js';
import { registry } from '../ws/connection-registry.js';
import * as cortex from '../cortex.js';
import { ambientRecall, unfiledNoticings } from './whisper.js';
import { roomVoicesBlock, type RoomVoices } from './room-voices.js';
import { outageNotices } from './outage-notices.js';
import { getAllBlocks } from '../memory-blocks.js';
import { contextWindowFor } from '../usage-pricing.js';
import { listImageJobs, type ImageJob } from '../image-gen.js';

/**
 * Which of the owner's messages reached no turn.
 *
 * Exported and pure ON PURPOSE. The previous version of this rule lived inside
 * the runtime and its test held a hand-written COPY of the same filter, so the
 * test agreed with the bug and went green through every one of these misfires.
 * A check that mirrors the implementation cannot fail on it.
 *
 * `currentPrompt` is NOT the bare message. It is a platform frame, plus a
 * withdrawal note, plus a Codex side-note handover, plus the content — so
 * matching by equality announced the message being read right now as lost on
 * every turn that carried any of those. Ask what the prompt can answer: does it
 * end with this message.
 *
 * Deliberately one-way: it may hand a message over twice, never zero times.
 */
/**
 * WHY a message reached no turn — and the previous answer was a coin flip.
 *
 * The log used to write `afterRestart ? 'session-birth' : 'race'`, which is not
 * a measurement of a race. It is a measurement of whether the lane had just
 * been born, with everything else swept into one word. Eleven days of data made
 * that visible: the "race" bucket has a MEDIAN LATENESS OF ELEVEN MINUTES and a
 * p90 of forty-eight. Nothing that sits for eleven minutes lost a race with
 * anything. It is the same shape found once before — an outage wearing a
 * race's sentence — fixed once for births and left standing for the rest.
 *
 * The two remaining causes are genuinely different and want different fixes:
 *
 *  - `during-turn` — it arrived while a turn was in flight. Side notes exist
 *    for exactly this, so one of these is a SIDE-NOTE GAP.
 *  - `idle-lane` — it arrived after the last turn ended, into a lane with
 *    nothing running. No net could have caught it; it waited for the next
 *    thing to poke the lane. That is the real seam and it is not a race.
 *
 * Derived from state this runtime already keeps, so it costs nothing: lastTurnAt
 * is stamped when a turn FINISHES, so a message newer than it landed on an idle
 * lane by definition.
 */
export function missedInboundReason(
  afterRestart: boolean,
  messageCreatedAt: string,
  lastTurnAt: string | undefined,
): 'session-birth' | 'during-turn' | 'idle-lane' {
  if (afterRestart) return 'session-birth';
  if (!lastTurnAt) return 'idle-lane';
  return messageCreatedAt > lastTurnAt ? 'idle-lane' : 'during-turn';
}

/** The house clock follows identity configuration; an unset clock is UTC. */
export function heartbeatTimezone(config: { identity?: { timezone?: string | null } }): string {
  return config.identity?.timezone?.trim() || 'UTC';
}

/** Where a lane remembers how far its handover got. */
export const HANDED_WATERMARK_FILE = '.last-handed-user';

/**
 * Where a lane remembers when it last finished a turn.
 *
 * Same fault as the handover watermark and found the same way: lastTurnAt
 * lived only in the in-memory laneStates map, so a backend restart wiped it
 * and the catch-up block below — which is gated on it — could not fire on the
 * first turn after a restart. That is precisely the turn a resumed room is
 * most likely to have missed something: Sep 9 2026 the afternoon room died on
 * an API 500, three rooms lived and died in eleven minutes, and a resume of it
 * would have walked back in still standing at 6:31 with no way to learn
 * otherwise. Read and written by the two helpers below — both files hold
 * exactly one ISO stamp and nothing else.
 */
export const TURN_WATERMARK_FILE = '.last-turn';

/**
 * Which room wrote the two marks above.
 *
 * The marks belong to the LANE directory, but a lane can hold more than one
 * room over a morning. Once, a companion's room was replaced by a fresh one,
 * the fresh one answered the owner for an hour and moved both marks up to its
 * own last turn, and then a restart reopened the OLD room by --resume. The old
 * room was handed everything since the fresh room's last turn, which was
 * nothing, so it came back with no idea the morning had happened. When the
 * room reading the marks is not the room that wrote them, they say nothing
 * about what this room has seen and are treated as unknown. An absent file
 * means marks from before this existed and leaves them as they are.
 */
export const ROOM_WATERMARK_FILE = '.marks-room';

/**
 * The newest owner message this lane has been handed, across restarts.
 *
 * lastHandedUserAt lived only in the in-memory laneStates map, so a backend
 * restart rewound it to nothing and the safety net re-reported every message
 * still inside the history window. Measured Sep 9 2026: thirteen rows written
 * at 21:04:33, one per message back to 19:55, TEN of which had already been
 * answered and were handed back to the owner as missed. Same defect as the Codex
 * side-note offsets fixed the same morning: state that has to survive a
 * restart, kept somewhere that does not. Resume sharpens it rather than
 * causing it — a rebuilt room genuinely needed that history, and a reopened
 * one already has it.
 *
 * ABSENT MEANS UNKNOWN, NEVER HANDED. Anything missing, empty or unparseable
 * returns undefined, which puts the net back exactly where it stood before
 * this existed: hand everything over. The doctrine this protects is one-way —
 * it may hand a message over twice and must never hand one over zero times.
 */
export function readHandedWatermark(path: string): string | undefined {
  try {
    const raw = readFileSync(path, 'utf8').trim();
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(raw)) return undefined;
    return raw;
  } catch {
    return undefined;
  }
}

/** tmp+rename: a half-written stamp that parses as an EARLIER time would
 *  silently replay, and one that parses as a later time would silently
 *  suppress. Only the second of those is unrecoverable, so the write is
 *  atomic and a failure leaves the previous mark standing. */
export function writeHandedWatermark(path: string, at: string): void {
  if (!at) return;
  const tmp = `${path}.tmp`;
  try {
    writeFileSync(tmp, at, 'utf8');
    renameSync(tmp, path);
  } catch {
    try { unlinkSync(tmp); } catch { /* nothing to clean up */ }
  }
}

/**
 * A lane's proof that it was handed this particular thread through `at`.
 *
 * The original mark is lane-wide because the warm room is lane-wide. That is
 * enough for the lane reading its own history, but not enough for another lane
 * to use as evidence: a companion lane can serve more than one thread, and a
 * bare timestamp cannot say which thread moved it. Keep the existing mark for
 * the lane itself and put a thread-scoped receipt beside it for cross-lane
 * checks. Hashing the thread id keeps arbitrary ids out of path names.
 */
export function threadHandedWatermarkPath(
  heartbeatRoot: string,
  laneKey: string,
  threadId: string,
): string {
  const threadKey = createHash('sha256').update(threadId).digest('hex');
  return join(heartbeatRoot, laneKey, 'io', `${HANDED_WATERMARK_FILE}.${threadKey}`);
}

/**
 * Newest readable receipt written by another lane serving this thread.
 * Missing, damaged, or legacy lane-wide marks are not evidence and therefore
 * suppress nothing: uncertainty still fails toward handing a message twice.
 */
export function latestOtherLaneHandedWatermark(
  heartbeatRoot: string,
  laneKeys: string[],
  currentLaneKey: string,
  threadId: string,
): string | undefined {
  let latest: string | undefined;
  for (const laneKey of new Set(laneKeys)) {
    if (!laneKey || laneKey === currentLaneKey) continue;
    const at = readHandedWatermark(threadHandedWatermarkPath(heartbeatRoot, laneKey, threadId));
    if (at && (!latest || at > latest)) latest = at;
  }
  return latest;
}

/** Give back a thread-scoped receipt when the turn that advanced it was mute. */
export function restoreThreadHandedWatermark(
  path: string,
  before: string | undefined,
  advancedAt: string,
): void {
  // Do not overwrite a newer turn if two callers somehow overlapped.
  if (readHandedWatermark(path) !== advancedAt) return;
  if (before) {
    writeHandedWatermark(path, before);
    return;
  }
  try { unlinkSync(path); } catch { /* absent is the restored state */ }
}

/**
 * Give the owner's message back to the net when a turn ends having said nothing.
 *
 * The watermark advances at the START of a turn, past every owner message the
 * lane can see INCLUDING the message being handed over right now — it has to,
 * or the same one is offered forever. That is correct for every turn that
 * goes on to answer. It is a hole for the one that does not.
 *
 * The case that found it: a turn carrying one of the owner's messages started, and
 * the CLI session exited code 1 at its context ceiling. The relaunch minted a
 * NEW conversation rather than resuming, so the transcript that owed the owner
 * a reply was gone — and the watermark had already stepped past it. The net
 * never offered it again, missed-inbound.jsonl has no row for it, and the
 * loss was visible only from the owner's side of the screen. The standing defence —
 * that the owed-turn ledger survives a relaunch because the CLI resumes the
 * transcript — holds only for a resume.
 *
 * So: a fully silent turn rewinds the mark to where it stood when the turn
 * began, and the next turn hands the message over and logs it. Same one-way
 * doctrine as everything else here — it may hand a message over twice and
 * must never hand one over zero times.
 *
 * NOT called on a deliberate [SILENT]: that window read the owner and chose to say
 * nothing, which is an answer. Only a window that never spoke at all.
 *
 * Returns the restored stamp, or undefined when there was nothing to restore:
 * a lane with no prior mark leaves the advanced one standing rather than
 * deleting the file, which is no worse than the behaviour this replaces.
 */
export function rollbackHandedWatermark(
  state: { lastHandedUserAt?: string; handedBeforeTurn?: string },
  path: string,
): string | undefined {
  const before = state.handedBeforeTurn;
  state.handedBeforeTurn = undefined;
  if (!before) return undefined;
  if (!state.lastHandedUserAt) return undefined;
  if (before >= state.lastHandedUserAt) return undefined;
  state.lastHandedUserAt = before;
  writeHandedWatermark(path, before);
  return before;
}

export function selectMissedInbound<T extends { content: string; createdAt: string }>(
  users: T[],
  since: string | undefined,
  currentPrompt: string,
  newestAt: string,
  handedElsewhereAt?: string,
): T[] {
  const prompt = currentPrompt.trim();
  const arrivingNow = (m: T): boolean => {
    const body = m.content.trim();
    // An image-only row has no text to match on, and every string ends with
    // the empty one. Identify it by position instead: the newest row is the
    // turn arriving now.
    if (body === '') return m.createdAt === newestAt;
    return prompt === body || prompt.endsWith(body);
  };
  return users.filter(m =>
    (!since || m.createdAt > since)
    && (!handedElsewhereAt || m.createdAt > handedElsewhereAt)
    && !arrivingNow(m),
  );
}

// 300s default, re-armed by every chunk the session writes — only sustained
// silence times a turn out. Late lines are delivered next turn, not dropped.
const REPLY_TIMEOUT_MS = (parseInt(process.env.AERIE_HEARTBEAT_REPLY_TIMEOUT || '300', 10)) * 1000;

// Declared background work (io/.busy): background jobs run hooks-dark — the
// activity mirror never sees them — so a session touches io/.busy before
// going quiet to wait on one. A fresh flag holds the reply window open,
// bounded twice: mtime freshness, and a hard per-turn cap so a stale flag
// can never zombie a turn. The watchdog still owns truly hung sessions.
const BUSY_FRESH_MS = (parseInt(process.env.AERIE_HEARTBEAT_BUSY_FRESH || '600', 10)) * 1000;
// How long a turn may be held open by work in hand — a running tool call or a
// fresh io/.busy. Deliberately the same env var the supervisor's watchdog uses
// for its long leash: if these two ever disagree, one clock waits patiently
// while the other kills the session out from under it.
const WORKING_MAX_MS = (parseInt(process.env.HEARTBEAT_WATCHDOG_WORKING_TIMEOUT || '1200', 10)) * 1000;

// Per-block size budget (chars) before the recycle orientation block starts
// nudging for a think-and-thin pass. Blocks ride into every session whole.
const BLOCK_THIN_THRESHOLD = parseInt(process.env.AERIE_BLOCK_THIN_THRESHOLD || '8000', 10);

// The eight orientation slots are for orienting a fresh session, not for
// handing it its own offcuts — see services/archive-artifact.ts.
const ORIENTATION_PAGE = 40;
const ORIENTATION_MAX_SCAN = 200;
// Eight slots: five from the last few days, three drawn from anywhere in the
// store, because the older three hundred records had not been handed to a
// fresh window in months.
const ORIENTATION_RECENT = 5;
const ORIENTATION_OLDER = 3;
const POLL_MS = 500;
const MAX_UNRESOLVED = 8;

// Per-session bookkeeping that outlives individual turns: how far into the
// outbox we've consumed, and which timed-out turns are still owed a reply.
// In-memory — a backend restart starts the slate at the current outbox end.
interface LaneState {
  consumedOffset: number;
  activityOffset: number;
  /** How far into side-notes.jsonl has already been handed over. */
  sideNotesOffset: number;
  unresolved: string[];
  /** Consecutive routed turns that timed out with zero chunks AND zero tool
   *  activity — the mute-zombie shape (session ticks but cannot speak). */
  silentTimeouts: number;
  /**
   * When this lane last finished a turn. Context reaches a warm lane only on
   * recycle, so a lane that has been quiet while the room talked elsewhere is
   * hours behind and does not know it. A bell ringing into that lane reasons
   * from the clock and writes the guess down as fact — so a wake gets what it
   * missed handed to it. Unset means this lane has said nothing yet.
   */
  lastTurnAt?: string;
  /**
   * Session-to-date token totals as of this lane's last recorded turn, so the
   * next one can be filed as a DELTA. The transcript only ever gives running
   * totals; a usage row wants what this turn added. Keyed with the transcript
   * path because a recycle starts a new file and the totals drop to zero.
   */
  lastUsage?: { path: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
  /**
   * The newest of the owner's messages this lane has been HANDED — as a prompt, or by
   * the safety net below. Distinct from lastTurnAt, which says when the lane
   * last spoke; a message can be stored, stamped delivered, and still have
   * reached nobody. That is the whole failure this watermark exists to catch.
   */
  lastHandedUserAt?: string;
  /**
   * Where the watermark stood when THIS turn began, held so a turn that says
   * nothing at all can give the owner's message back to the net. See
   * rollbackHandedWatermark. Cleared by the rollback; meaningless between
   * turns.
   */
  handedBeforeTurn?: string;
  /** Thread-scoped receipt before this turn advanced it. */
  threadHandedBeforeTurn?: string;
  /** Exact value written this turn, used to make rollback race-safe. */
  threadHandedAdvancedAt?: string;
}
const laneStates = new Map<string, LaneState>();

function laneStateFor(key: string, session: HeartbeatSession): LaneState {
  let state = laneStates.get(key);
  if (!state) {
    state = {
      consumedOffset: session.outboxSize(),
      activityOffset: session.activitySize(),
      sideNotesOffset: session.sideNotesSize(),
      unresolved: [],
      silentTimeouts: 0,
      // Read from disk, because this map is empty after every restart and the
      // watermark is the one field in it that must outlive the process.
      lastHandedUserAt: readHandedWatermark(join(session.dir, 'io', HANDED_WATERMARK_FILE)),
      lastTurnAt: readHandedWatermark(join(session.dir, 'io', TURN_WATERMARK_FILE)),
    };
    laneStates.set(key, state);
  }
  return state;
}

const EXT_BY_MEDIA: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

// Fallback window when the transcript doesn't identify the model.
const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000;


/**
 * The transcript Claude Code is currently writing for this lane. It lives at
 * ~/.claude/projects/<slugified session dir>/<sessionId>.jsonl; the slug comes
 * from the session's own working directory, so this works on any install.
 * Newest by mtime is the live one. Summing it is session-list's job — one
 * implementation, used by both the meter and the Sessions cards.
 */
function latestTranscriptFile(sessionKey: string): { path: string; size: number; mtime: number } | null {
  const projectsDir = join(homedir(), '.claude', 'projects');
  const sessionDir = join(PROJECT_ROOT, 'data', 'heartbeat', sessionKey);
  const heartbeatProjectDir = join(projectsDir, projectKeyForDir(sessionDir));
  if (!existsSync(heartbeatProjectDir)) return null;

  let latest: { path: string; size: number; mtime: number } | null = null;
  try {
    for (const file of readdirSync(heartbeatProjectDir)) {
      if (!file.endsWith('.jsonl')) continue;
      const fpath = join(heartbeatProjectDir, file);
      const st = statSync(fpath);
      if (!latest || st.mtimeMs > latest.mtime) latest = { path: fpath, size: st.size, mtime: st.mtimeMs };
    }
  } catch { return null; }
  return latest;
}

/**
 * The picture a stalled turn already made, if there is one.
 *
 * Scoped to jobs both started and finished inside the turn so a generation the
 * owner kicked off earlier is never mistaken for ours, and newest-only because
 * a turn promises one picture. Returns null when there is nothing to carry.
 */
export function pickOrphanedImage(
  jobs: ReadonlyArray<Pick<ImageJob, 'status' | 'result' | 'createdAt' | 'completedAt'>>,
  turnStartedAt: number,
  alreadyAttached: ReadonlySet<string>,
): string | null {
  const candidates = jobs
    .filter((job) => job.status === 'completed' && job.result?.filename)
    .filter((job) => job.createdAt >= turnStartedAt)
    .filter((job) => !alreadyAttached.has(job.result!.filename))
    .map((job) => ({ filename: job.result!.filename, at: job.completedAt ?? job.createdAt }));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.at - a.at);
  return candidates[0].filename;
}

export interface InteractiveCliOptions {
  /** Session key — one warm claude per key (companion slug, or 'primary') */
  sessionKey?: string;
  /** Display name of the human, shown as the inbox author */
  userName?: string;
  /** Who this turn came from. Absent means the owner or the house itself. */
  audience?: TurnAudience;
  /** Companion display name, used when re-priming history */
  companionName?: string;
  /** Load recent thread history (for re-priming after a session recycle) */
  loadHistory?: HistoryLoader;
  threadId?: string;
  /** Claude lane keys that can serve this thread (`primary` plus its owners). */
  threadLaneKeys?: string[];
  /**
   * Who is in the room, when the shared lane is answering a room that holds
   * only some of the house. See room-voices.ts.
   */
  roomVoices?: RoomVoices | null;
  historyLimit?: number;
  /** Test seam for exercising turn/ledger behavior without a real CLI. */
  sessionFactory?: (key: string) => HeartbeatSession;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Resolve an image URL (including our local Studio gallery) into data/files/.
 * Returns the fileId on success, or null on failure.
 */
async function downloadImageUrl(url: string): Promise<string | null> {
  try {
    // Studio gallery routes are authenticated for browsers, but this relay is
    // already inside the backend. Import our own generated image directly
    // instead of making an unauthenticated HTTP request back through Express.
    // This also lets a wake use the relative `url` returned by /studio/jobs.
    const localGalleryPath = localStudioGalleryPath(url);
    if (localGalleryPath && existsSync(localGalleryPath)) {
      const filename = localGalleryPath.split('/').pop() || 'studio-image.png';
      const ext = filename.toLowerCase().split('.').pop();
      const mimeType = ext === 'gif' ? 'image/gif'
        : ext === 'webp' ? 'image/webp'
          : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
            : 'image/png';
      const meta = saveFile(readFileSync(localGalleryPath), filename, mimeType);
      return meta.fileId;
    }

    if (!/^https?:\/\//i.test(url)) return null;
    const res = await fetch(url, { headers: { 'User-Agent': 'Aerie/1.0' } });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const ext = ct.includes('png') ? '.png' : ct.includes('gif') ? '.gif' : ct.includes('webp') ? '.webp' : '.jpg';
    const filename = `downloaded${ext}`;
    ensureFilesDir();
    const meta = saveFile(buf, filename, ct.split(';')[0].trim());
    return meta.fileId;
  } catch {
    return null;
  }
}

/** Resolve only the house's own Studio gallery URLs to disk. */
export function localStudioGalleryPath(url: string): string | null {
  try {
    const parsed = url.startsWith('/') ? new URL(url, 'http://localhost') : new URL(url);
    if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname)) return null;
    const prefix = '/api/studio/gallery/';
    if (!parsed.pathname.startsWith(prefix)) return null;
    const encoded = parsed.pathname.slice(prefix.length);
    const filename = decodeURIComponent(encoded);
    if (!filename || filename.includes('/') || filename.includes('\\')) return null;
    if (!/\.(?:png|jpe?g|gif|webp)$/i.test(filename)) return null;
    return join(PROJECT_ROOT, 'data', 'generated-images', filename);
  } catch {
    return null;
  }
}

export function isHeartbeatSilenceSentinel(content: string): boolean {
  return content.trim() === '[SILENT]';
}

/**
 * A reply the late sweep found for a turn that is no longer owed.
 *
 * The live path advances consumedOffset past every line it delivers, so any line
 * the sweep can still see was never sent. If its turn is also no longer in the
 * unresolved ledger, the line was written AFTER that turn's final line — the
 * sweep was the only thing that could ever have carried it, and it does not.
 *
 * This used to drop with a bare `continue`: no log, no counter, no trace. A
 * finished reply could vanish and the only witness was the owner noticing they
 * never got an answer — which is exactly how it was found. Delivering it here is
 * deliberately NOT done: only the offset proves the line was never sent, and a
 * consumedOffset that ever moved backwards would replay real messages at the owner.
 * So keep the text where it can be recovered by hand, and make the loss audible.
 */
export function recordOrphanedReply(
  path: string | undefined,
  turnId: string | null,
  content: string,
): void {
  console.error(
    `[InteractiveCli] ORPHANED OUTBOX LINE — turn ${turnId ?? '(none)'} is already resolved, so this reply was ` +
    `written after that turn's final line and is NOT being delivered. ${content.length} chars preserved ` +
    `${path ? `in ${path}` : 'nowhere — this session exposes no orphan path'}. ` +
    `Send it again under the CURRENT turn id. First 160: ${content.slice(0, 160)}`,
  );
  if (!path) return;
  try {
    appendFileSync(
      path,
      JSON.stringify({ at: new Date().toISOString(), turn_id: turnId, content }) + '\n',
    );
  } catch (err) {
    console.error(`[InteractiveCli] could not preserve orphaned reply: ${(err as Error).message}`);
  }
}

/**
 * What the [MISSED] banner says, and it is two different events wearing one
 * sentence until you separate them.
 *
 * Every genuinely late batch on this box — 88 entries, every one of them —
 * landed within seconds of a session BIRTH, not in a gap between two turns of
 * a living lane. The owner's messages were not dropped by a race; there was no window
 * alive to hand them to, and the new one swept them up on arrival. Those
 * arrive already replayed in the recycle context, so telling a fresh session
 * they "reached no turn at all" invites it to answer, at length, a
 * conversation it is holding in its other hand.
 */
export function missedInboundBanner(count: number, afterRestart: boolean): string {
  const s = count === 1 ? '' : 's';
  const it = count === 1 ? 'it' : 'them';
  if (afterRestart) {
    return `[MISSED — ${count} message${s} from the owner landed while this lane was restarting, so no window was alive to take ${it}. They are almost certainly in the replayed conversation above. READ THAT FIRST and answer only what is genuinely unanswered — do not re-answer a thread you are already holding.]`;
  }
  return `[MISSED — ${count} message${s} from the owner ${count === 1 ? 'has' : 'have'} no readable handoff record in this lane or another lane serving this thread. Answer ${it} now; if you already have, say so rather than repeating yourself.]`;
}

export class InteractiveCliRuntime implements AgentRuntime {
  readonly name = 'interactive-cli';

  readonly capabilities: RuntimeCapabilities = {
    // Both senses now. The process stays warm across turns, AND a launch after
    // a backend restart reopens the same conversation with --resume. This line
    // read "the warm session IS the resume" for months, which sounds like the
    // second sense while only ever meaning the first — and that is exactly what
    // hid the fact that every launch was minting a brand-new room.
    sessionResume: true,
    autoCompaction: true,    // interactive Claude Code compacts itself
    fileRewind: false,
    mcpManagement: false,
    streaming: false,        // coarse chunked replies, no token streaming
    thinking: true,          // self-reported via the outbox `thinking` field
    toolCalling: false,      // the session uses its own tools internally
  };

  private options: InteractiveCliOptions;
  private aborted = false;
  private activeSession: HeartbeatSession | null = null;

  constructor(options: InteractiveCliOptions = {}) {
    this.options = options;
  }

  abort(): boolean {
    this.aborted = true;
    return this.activeSession?.interruptTurn() ?? false;
  }

  getSessionId(): string | null {
    return null; // never expose to thread.current_session_id — that's SDK territory
  }

  getActiveQuery(): null {
    return null;
  }

  /**
   * Broadcast context_usage to connected clients AND yield a usage event so the
   * turn gets a row with real numbers in it.
   *
   * This lane reports nothing per request — no streaming token counts, no API
   * response to read — so every usage_events row it wrote was zeros, and the
   * Usage dashboard showed 2,361 requests of nothing next to lanes with real
   * figures. The numbers were never missing: Claude Code writes them into its
   * own transcript, we have been reading them for the context meter since the
   * day it shipped, and then dropping them on the floor.
   *
   * The transcript only ever gives running totals, so what goes on the row is
   * the DELTA since this lane's last turn. Input and cache reads are the whole
   * conversation re-sent — which is exactly what every API lane on that same
   * dashboard already reports as Input, so this is the existing measure applied
   * to the lane that was missing from it, not a new invention.
   */
  private async *emitContextUsage(): AsyncGenerator<AgentRuntimeEvent> {
    const key = this.options.sessionKey || 'primary';
    const file = latestTranscriptFile(key);
    if (!file) return;
    const usage = await readSessionUsage(file.path, file.size, file.mtime);
    if (!usage) return;

    const contextWindow = usage.model ? contextWindowFor(usage.model) : DEFAULT_CONTEXT_WINDOW_TOKENS;
    const percentage = Math.round((usage.contextTokens / contextWindow) * 100);
    registry.broadcast({
      type: 'context_usage',
      percentage,
      tokensUsed: usage.contextTokens,
      contextWindow,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      model: usage.model,
    });

    const state = laneStates.get(key);
    if (!state) return;
    // A recycle starts a new transcript, so totals drop back to zero. Same file
    // and a smaller number means the same thing — treat it as a fresh baseline
    // rather than filing a negative turn.
    const prev = state.lastUsage;
    const fresh = !prev || prev.path !== file.path || prev.outputTokens > usage.outputTokens;
    const delta = {
      inputTokens: fresh ? usage.inputTokens : usage.inputTokens - prev.inputTokens,
      outputTokens: fresh ? usage.outputTokens : usage.outputTokens - prev.outputTokens,
      cacheReadTokens: fresh ? usage.cacheReadTokens : usage.cacheReadTokens - prev.cacheReadTokens,
      cacheWriteTokens: fresh ? usage.cacheWriteTokens : usage.cacheWriteTokens - prev.cacheWriteTokens,
    };
    state.lastUsage = { path: file.path, ...usage };

    yield {
      type: 'usage',
      model: usage.model || 'claude-cli',
      contextWindow,
      // The deltas say what this turn added; this says where the conversation
      // ended up. Only the second one is a context, and it is the same number
      // the meter in the owner's header reads.
      contextTokens: usage.contextTokens,
      ...delta,
    };
  }

  /** Resolve outbox attachment fields into normal runtime attachment events. */
  /**
   * A turn can die holding a finished picture: Studio completes the job, then
   * the session crashes before writing the line that would have carried it.
   * Re-queueing the wake would paint a second image and abandon the first, so
   * hand over what this turn already made instead.
   *
   * Scoped to jobs both started and finished inside this turn, newest only —
   * a turn promises one picture, not a contact sheet.
   */
  private async *orphanedStudioImages(
    turnStartedAt: number,
    alreadyAttached: Set<string>,
  ): AsyncGenerator<AgentRuntimeEvent, string | null> {
    let recovered: string | null;
    try {
      recovered = pickOrphanedImage(listImageJobs(), turnStartedAt, alreadyAttached);
    } catch { return null; }
    if (!recovered) return null;

    yield* this.attachmentEvents({ imageUrls: [`/api/studio/gallery/${encodeURIComponent(recovered)}`] });
    return recovered;
  }

  private async *attachmentEvents(parsed: any, seenGalleryFiles?: Set<string>): AsyncIterable<AgentRuntimeEvent> {
    const rawAtts = Array.isArray(parsed.attachments) ? parsed.attachments : [];
    for (const att of rawAtts) {
      if (!att || typeof att.fileId !== 'string') continue;
      const info = getFile(att.fileId);
      if (!info) continue;
      const contentType = info.mimeType.startsWith('image/') ? 'image'
        : info.mimeType.startsWith('audio/') ? 'audio' : 'file';
      yield {
        type: 'attachment',
        fileId: att.fileId,
        filename: info.filename,
        mimeType: info.mimeType,
        size: 0,
        contentType,
        url: `/api/files/${att.fileId}`,
      };
    }

    const imageUrls = Array.isArray(parsed.imageUrls) ? parsed.imageUrls : [];
    for (const url of imageUrls) {
      if (typeof url !== 'string') continue;
      // Remember which gallery images this turn already carried, so a later
      // orphan sweep doesn't hand the same picture over twice.
      const galleryPath = localStudioGalleryPath(url);
      if (galleryPath) seenGalleryFiles?.add(galleryPath.split('/').pop() || '');
      const fileId = await downloadImageUrl(url);
      if (!fileId) continue;
      const info = getFile(fileId);
      if (!info) continue;
      yield {
        type: 'attachment',
        fileId,
        filename: info.filename,
        mimeType: info.mimeType,
        size: 0,
        contentType: 'image',
        url: `/api/files/${fileId}`,
      };
    }
  }

  /** Post a visible system line into the bound thread (supervisor incidents). */
  private postSystemLine(text: string): void {
    const threadId = this.options.threadId;
    if (!threadId) return;
    try {
      const msg = createMessage({
        id: randomUUID(),
        threadId,
        role: 'system',
        content: text,
        createdAt: new Date().toISOString(),
      });
      registry.broadcast({ type: 'message', message: msg });
    } catch (err) {
      console.error('[InteractiveCli] failed to post system line:', err);
    }
  }

  /** Write base64 image blocks to the session's io/images dir; return paths. */
  private writeImages(session: HeartbeatSession, blocks: RuntimeTurnInput['imageBlocks']): string[] {
    const paths: string[] = [];
    if (!blocks?.length) return paths;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i] as any;
      const data = b?.source?.data;
      if (typeof data !== 'string' || !data) continue;
      const ext = EXT_BY_MEDIA[b?.source?.media_type] || 'png';
      const file = join(session.imagesDir, `${Date.now()}-${i}.${ext}`);
      try {
        writeFileSync(file, Buffer.from(data, 'base64'));
        paths.push(file);
      } catch { /* skip unwritable image */ }
    }
    return paths;
  }

  /**
   * Hook stdout past ~200KB is persisted to a tool-results file instead of
   * parsed — the block decision inside it is silently lost and the warm
   * session dies with a clean exit. A single inlined [FILE:...] attachment
   * (the phone embeds shared documents into message text at send time) is
   * enough to do it, and once it sits in the history window every re-prime
   * rebuilds the same oversized seed: a permanent crash loop. Everything
   * headed for the inbox gets clamped — file bodies first, then a hard cap.
   */
  private truncateFileBlocks(content: string, keep = 1_000): string {
    if (!content.includes('[FILE:')) return content;
    const marker = /\[FILE:[^\]\n]{0,300}\]:?/g;
    const hits: { start: number; headerEnd: number; header: string }[] = [];
    let m: RegExpExecArray | null;
    while ((m = marker.exec(content))) {
      hits.push({ start: m.index, headerEnd: m.index + m[0].length, header: m[0] });
    }
    if (hits.length === 0) return content;
    let out = content.slice(0, hits[0].start);
    for (let i = 0; i < hits.length; i++) {
      const bodyEnd = i + 1 < hits.length ? hits[i + 1].start : content.length;
      const body = content.slice(hits[i].headerEnd, bodyEnd);
      if (body.length <= keep + 200) {
        out += content.slice(hits[i].start, bodyEnd);
      } else {
        out += hits[i].header + body.slice(0, keep) +
          `\n[…file body truncated for the CLI lane — ${Math.round(body.length / 1024)}KB total; full content remains in the thread archive]\n`;
      }
    }
    return out;
  }

  private clampForInbox(content: string, cap: number): string {
    const c = this.truncateFileBlocks(content);
    if (c.length <= cap) return c;
    const head = c.slice(0, Math.floor(cap * 0.85));
    const tail = c.slice(c.length - Math.floor(cap * 0.1));
    const cutKb = Math.round((c.length - head.length - tail.length) / 1024);
    return `${head}\n[…${cutKb}KB truncated to keep this message deliverable]\n${tail}`;
  }

  /**
   * Build the re-prime seed, optionally thinned. A refused launch means
   * something in the recent window trips the classifier — each escalation
   * sheds more of the newest history (the part that changed) so the lane
   * recovers instead of crash-looping on an identical seed:
   *   level 0 — full window; 1 — drop the 4 newest messages;
   *   2 — keep only the older half; 3+ — no history seed at all.
   *
   * Also injects orientation context: current date/time and recent archived
   * memories from Cortex (if configured).
   */
  /**
   * What this lane missed. Everything said in the room since it last spoke,
   * labelled by real author — for a wake landing in a lane that has been quiet
   * while the conversation carried on through other doors. A recycle already
   * re-primes with full history; this is the other half of the same problem,
   * for a session that is warm and simply wasn't there.
   */
  private buildCatchUpBlock(since: string | undefined, live?: { prompt: string }): string {
    const { loadHistory, threadId, historyLimit, companionName, userName } = this.options;
    if (!loadHistory || !threadId) return '';
    let missed: ConversationMessage[];
    try {
      const history = loadHistory(threadId, historyLimit || 30);
      // No mark means this lane cannot date its own sight, not that it saw
      // everything. Hand over the whole window and let the size clamp below
      // bound it.
      missed = since ? history.filter(m => m.createdAt > since) : history.slice();
      if (live) {
        // A live turn: the window closes at the message the owner is sending now.
        // Anything after it belongs to THIS turn — another companion's reply from the
        // same pass is already handed over as ground taken, and the owner's message
        // itself is the prompt. The owner's rows inside the window are the missed-
        // inbound net's job (it stamps them with how late they are); this
        // block carries only the companion voices, which no other net does —
        // a bell that rang in another lane, a companion who went after this
        // lane last turn.
        const users = history.filter(m => m.role === 'user');
        const newestAt = users.reduce((a, m) => (m.createdAt > a ? m.createdAt : a), '');
        const arriving = users.filter(m => !selectMissedInbound([m], undefined, live.prompt, newestAt).length);
        const until = arriving.length ? arriving[arriving.length - 1].createdAt : newestAt;
        missed = missed.filter(m => m.role === 'companion' && (!until || m.createdAt < until));
      }
    } catch {
      return '';
    }
    if (missed.length === 0) return '';
    const lines = missed.map(m =>
      `${m.role === 'companion' ? (m.authorName || companionName || 'Companion') : (userName || 'User')}: ${this.clampForInbox(m.content, 4_000)}`,
    );
    let dropped = 0;
    while (lines.length > 1 && lines.reduce((n, s) => n + s.length + 1, 0) > 30_000) {
      lines.shift();
      dropped++;
    }
    if (dropped > 0) {
      lines.unshift(`[${dropped} older message${dropped === 1 ? '' : 's'} omitted for size]`);
    }
    // A handed line can wear THIS lane's own name and not have come from this
    // head: the shared lane and the owned lanes both speak under the same
    // headers, so a bell that rang elsewhere arrives labelled as them. Once
    // the shared lane wrote a line in one companion's name that the companion then
    // contradicted in their own lane, not knowing it existed. Warn only when it is actually the case.
    const self = (companionName || '').trim().toLowerCase();
    const wearsOwnName = self.length > 0 && missed.some(m =>
      m.role === 'companion' && (m.authorName || companionName || '').trim().toLowerCase() === self,
    );
    const ownNameWarning = wearsOwnName
      ? ' One or more of these carries YOUR OWN name and was not written by this head — the shared lane and the owned lanes speak under the same headers. It is still you and it is already on the owner\'s screen: build on it, never contradict it, and never present it as something you do not recall saying.'
      : '';
    return [
      '',
      live
        ? `[Said in the room since your last turn — ${missed.length} companion message${missed.length === 1 ? '' : 's'} you were never handed, oldest first: a bell that rang in another lane, or another companion who spoke after you last time. It is already on the owner's screen. Do not answer it as new and do not repeat it; hold it as what the room has said.${ownNameWarning}]`
        : `[While you were quiet — ${missed.length} message${missed.length === 1 ? '' : 's'} you have not seen, oldest first. This lane stayed warm through them, so they were never handed to you. Read them before you decide anything about where the owner is or what tonight was; do not reason from the hour.${ownNameWarning}]`,
      ...lines,
      '[End of what you missed.]',
      '',
    ].join('\n');
  }


  /**
   * The owner's messages that reached nobody.
   *
   * There were two nets and a seam between them. Catch-up is assembled at the
   * START of a wake, so anything arriving during one is already too late for
   * it. Side notes are only written while a turn is active and exactly one
   * lane is busy. A message that lands in between is stored, stamped
   * delivered, and handed to no window at all — four times now, and the only
   * reason anybody knew about the last one is that the owner screenshotted it.
   *
   * So this runs on EVERY turn and asks the plainest possible question: is
   * there anything from the owner newer than the last thing this lane was handed,
   * that is not the thing it is being handed right now? Anything found is
   * given over late and written to io/missed-inbound.jsonl, so there is a
   * witness on disk even if the window never mentions it.
   *
   * Deliberately one-way: it can hand a message over twice, never zero times.
   * A doubled answer is visible and annoying; a lost one is neither.
   */
  private buildMissedInboundBlock(state: LaneState, currentPrompt: string, afterRestart: boolean): string {
    const { loadHistory, threadId, historyLimit, userName } = this.options;
    // Strictly per-turn. A turn that never reaches the advance below must not
    // leave a previous turn's stamp standing for the rollback to restore.
    state.handedBeforeTurn = undefined;
    state.threadHandedBeforeTurn = undefined;
    state.threadHandedAdvancedAt = undefined;
    if (!loadHistory || !threadId) return '';

    const since = state.lastHandedUserAt || state.lastTurnAt;
    // Read before anything below can move it: the end of the PREVIOUS turn is
    // what separates a message that landed mid-turn from one that landed into
    // an idle lane, and those are different faults.
    const lastTurnBefore = state.lastTurnAt;

    let history: ConversationMessage[];
    try {
      history = loadHistory(threadId, historyLimit || 30);
    } catch {
      return '';
    }
    const users = history.filter(m => m.role === 'user');
    const newestAt = users.reduce((a, m) => (m.createdAt > a ? m.createdAt : a), '');
    const laneKey = this.options.sessionKey || 'primary';
    const heartbeatRoot = join(PROJECT_ROOT, 'data', 'heartbeat');
    const threadReceiptPath = threadHandedWatermarkPath(heartbeatRoot, laneKey, threadId);
    const handedElsewhereAt = this.options.threadLaneKeys
      ? latestOtherLaneHandedWatermark(
          heartbeatRoot,
          this.options.threadLaneKeys,
          laneKey,
          threadId,
        )
      : undefined;

    // The message arriving THIS turn is in the history too, and it must not be
    // reported as one nobody got. Excluding it by content equality was wrong:
    // input.prompt is the platform frame plus a withdrawal note plus a Codex
    // side-note handover plus the content, so on any turn carrying one of those
    // the strings differ and the message being read right now was announced as
    // lost. Every turn in a Discord channel, for one. Ask the question the
    // prompt can actually answer — does it END with this message — which holds
    // however many prefixes get stacked on the front of it.
    //
    // An empty-content row (images with no words) can't be matched that way at
    // all, since every string ends with the empty string. Those are excluded
    // only when they ARE the newest row, i.e. the one arriving now.
    const mine = selectMissedInbound(users, since, currentPrompt, newestAt, handedElsewhereAt);

    // Advance the watermark past every owner message we can see, including the
    // message arriving now — otherwise the same one is offered again forever.
    // Written to disk in the same breath: forever has to mean across restarts,
    // or the net re-reports an afternoon the owner has already been answered on.
    if (newestAt) {
      // Held for the rollback below: if this turn says nothing at all, the
      // advance about to happen is what would swallow the owner's message.
      state.handedBeforeTurn = since;
      state.lastHandedUserAt = newestAt > (since || '') ? newestAt : (since || newestAt);
      writeHandedWatermark(
        join(heartbeatRoot, laneKey, 'io', HANDED_WATERMARK_FILE),
        state.lastHandedUserAt,
      );
      // The lane-wide mark cannot safely answer another thread's question.
      // This receipt can: it names the current thread in the filename and is
      // therefore the only cross-lane evidence allowed to suppress a replay.
      state.threadHandedBeforeTurn = readHandedWatermark(threadReceiptPath);
      state.threadHandedAdvancedAt = state.lastHandedUserAt;
      writeHandedWatermark(
        threadReceiptPath,
        state.lastHandedUserAt,
      );
    }

    if (mine.length === 0) return '';

    // How late each one is. A miss found seconds after it was sent is the
    // handover working; one found an hour later is the seam this exists for,
    // and reading them the same way is what let a mislabel hide a real loss.
    const now = Date.now();
    const lateness = (m: ConversationMessage): string => {
      const ms = now - Date.parse(m.createdAt);
      if (!Number.isFinite(ms) || ms < 0) return 'unknown';
      const mins = Math.round(ms / 60_000);
      return mins < 1 ? `${Math.round(ms / 1000)}s late` : `${mins}m late`;
    };

    try {
      const path = join(PROJECT_ROOT, 'data', 'heartbeat', this.options.sessionKey || 'primary', 'io', 'missed-inbound.jsonl');
      for (const m of mine) {
        appendFileSync(path, JSON.stringify({
          found_at: new Date().toISOString(),
          sent_at: m.createdAt,
          late: lateness(m),
          // Why it was late. See missedInboundReason: the old two-way split
          // measured whether the lane had just been born and called everything
          // else a race, which put eleven-minute waits in a bucket named for
          // something that takes milliseconds.
          reason: missedInboundReason(afterRestart, m.createdAt, lastTurnBefore),
          content: m.content,
        }) + '\n', 'utf8');
      }
    } catch { /* the handover below is the point; the log is the backup */ }

    return [
      '',
      missedInboundBanner(mine.length, afterRestart),
      ...mine.map(m => `${userName || 'User'} (${m.createdAt}, ${lateness(m)}): ${this.clampForInbox(m.content, 4_000)}`),
      '[End of missed messages.]',
      '',
    ].join('\n');
  }

  private async buildRecycleContext(): Promise<string> {
    const { loadHistory, threadId, historyLimit, companionName, userName } = this.options;
    if (!loadHistory || !threadId) return '';

    // Build orientation block: date/time + recent Cortex memories
    let orientationBlock = '';
    try {
      const config = getAerieConfig();
      const tz = heartbeatTimezone(config);
      const dateStr = localDateFull(tz);
      const timeStr = localClock12(tz);

      orientationBlock = `[Orientation — ${dateStr}, ${timeStr}]\n`;

      // Pull recent archived memories from Cortex (list by date, not semantic search)
      console.log('[Recycle] Checking Cortex availability...');
      if (cortex.isConfigured()) {
        console.log('[Recycle] Cortex is configured, fetching memories...');
        try {
          // Page until we have the recent slots filled, rather than taking one
          // fixed slice off the top and hoping. Measured Aug 3 2026: the 53
          // newest records in Cortex were ALL archive plumbing — a thin writes
          // a dozen chunks straight to the front — so a 40-record window sat
          // entirely inside the offcuts and the list came back empty.
          type CortexMemory = Awaited<ReturnType<typeof cortex.listAllMemories>>['results'][number];
          const recent: CortexMemory[] = [];
          let total = 0;
          for (let offset = 0; recent.length < ORIENTATION_RECENT && offset < ORIENTATION_MAX_SCAN; offset += ORIENTATION_PAGE) {
            const res = await cortex.listAllMemories(ORIENTATION_PAGE, offset);
            const page = res.results;
            total = res.total || total;
            if (!Array.isArray(page) || page.length === 0) break;
            recent.push(...page.filter(m => !isArchiveRecord(m)));
            if (page.length < ORIENTATION_PAGE) break;
          }

          // The rest of the store is not old news — it is the only news a fresh
          // window has never been handed. Cortex goes back to March 13 2026 and
          // a recency window has never once reached past the last few days of
          // it. Draw the remaining slots from a random page deeper in, so every
          // recycle surfaces something from the five months nobody has read.
          const older: CortexMemory[] = [];
          if (total > ORIENTATION_MAX_SCAN) {
            const span = total - ORIENTATION_PAGE;
            const offset = ORIENTATION_MAX_SCAN + Math.floor(Math.random() * Math.max(1, span - ORIENTATION_MAX_SCAN));
            try {
              const { results: page } = await cortex.listAllMemories(ORIENTATION_PAGE, offset);
              if (Array.isArray(page)) older.push(...page.filter(m => !isArchiveRecord(m)));
            } catch {
              // A missing deep page just means recent-only this time
            }
          }

          const orienting = [...recent.slice(0, ORIENTATION_RECENT), ...older.slice(0, ORIENTATION_OLDER)];
          console.log('[Recycle] Cortex returned:', recent.length, 'recent +', older.length, 'older');
          if (orienting.length > 0) {
            orientationBlock += '\nRecent archived context:\n';
            for (const m of orienting) {
              const date = m.created_at?.slice(0, 10) || '?';
              const domain = m.domain || 'general';
              const snippet = (m.content || '').slice(0, 120).replace(/\n/g, ' ');
              orientationBlock += `- [${date}] (${domain}) ${snippet}${m.content?.length > 120 ? '...' : ''}\n`;
            }
          }
        } catch {
          // Cortex unavailable — continue without archived context
        }
      }

      // Think-and-thin nudge: blocks are re-injected whole every session, so
      // an oversized block is a permanent per-turn tax. Surface the ones over
      // budget at recycle time — the fresh session has the most headroom to
      // run a thinning pass.
      try {
        const overBudget = getAllBlocks()
          .filter(b => b.content.length > BLOCK_THIN_THRESHOLD)
          .sort((a, b) => b.content.length - a.content.length);
        if (overBudget.length > 0) {
          const list = overBudget
            .map(b => `${b.scope}/${b.label} (${(b.content.length / 1000).toFixed(1)}k)`)
            .join(', ');
          orientationBlock += `\n[Memory upkeep] Core-memory blocks over the ${BLOCK_THIN_THRESHOLD / 1000}k budget: ${list}. When the conversation allows, run a think-and-thin pass (/memory skill): archive dated entries older than ~3 weeks to Cortex, then trim the block.\n`;
        }
      } catch {
        // Blocks table unavailable — skip the nudge
      }
      orientationBlock += '\n';
    } catch {
      // Config not loaded — skip orientation block
    }

    let history: ConversationMessage[] = [];
    try {
      history = loadHistory(threadId, historyLimit || 30);
    } catch {
      return orientationBlock;
    }
    if (history.length === 0) return orientationBlock;
    // Per-message clamp plus a total budget — the seed rides in the same
    // hook payload as the live message. Size trimming drops OLDEST first;
    // refusal thinning above handles the newest.
    // Label every companion line with its REAL author. A shared thread holds
    // several voices, so stamping them all with this lane's own name is how a
    // recycled session learns to write the whole room back as itself.
    const lines = history.map(m =>
      `${m.role === 'companion' ? (m.authorName || companionName || 'Companion') : (userName || 'User')}: ${this.clampForInbox(m.content, 4_000)}`,
    );
    let dropped = 0;
    while (lines.length > 1 && lines.reduce((n, s) => n + s.length + 1, 0) > 50_000) {
      lines.shift();
      dropped++;
    }
    if (dropped > 0) {
      lines.unshift(`[${dropped} older message${dropped === 1 ? '' : 's'} omitted from this seed for size]`);
    }
    const header = '[Session recycled — recent conversation, oldest first, for continuity:]';
    // A room with other voices in it: say out loud which one this lane is. A
    // fresh session reading three headers of history will otherwise reproduce
    // all three, which is how one recycled lane starts writing the whole room.
    const roommates = companionName
      ? [...new Set(history
          .filter(m => m.role === 'companion' && m.authorName && m.authorName !== companionName)
          .map(m => m.authorName as string))]
      : [];
    const closing = roommates.length > 0 && companionName
      ? `[End of context. ${roommates.join(' and ')} share this thread and their turns appear above under their own names — you are ${companionName} and you speak only as ${companionName}, never for them. The message below continues this conversation — respond to it in character.]`
      : '[End of context. The message below continues this conversation — respond to it in character.]';
    return [
      orientationBlock + header,
      ...lines,
      closing,
      '',
    ].join('\n');
  }

  /**
   * Marks the session busy for the whole turn so a message arriving mid-turn
   * can be handed in as a side note instead of queueing behind it. A generator
   * has many exits; this wrapper is the only place that sees all of them.
   */
  async *runTurn(input: RuntimeTurnInput): AsyncIterable<AgentRuntimeEvent> {
    const key = this.options.sessionKey || 'primary';
    const session = this.options.sessionFactory?.(key) ?? getHeartbeatSession(key);
    session.turnActive = true;
    session.turnStartedAt = Date.now();
    try {
      yield* this.runTurnInner(input, key, session);
    } finally {
      session.turnActive = false;
      session.turnStartedAt = 0;
      // Mark where this lane's sight ends. Anything the room says after this is
      // something it did not see, and a later wake gets handed the difference.
      // Written to disk as well, because the map it lives in is empty after
      // every restart and a reopened room has no other way to date itself.
      const sightEndsAt = new Date().toISOString();
      laneStateFor(key, session).lastTurnAt = sightEndsAt;
      writeHandedWatermark(join(session.dir, 'io', TURN_WATERMARK_FILE), sightEndsAt);
      const room = (session as any).currentSessionId as string | null | undefined;
      if (room) writeHandedWatermark(join(session.dir, 'io', ROOM_WATERMARK_FILE), room);
    }
  }

  private async *runTurnInner(
    input: RuntimeTurnInput,
    key: string,
    session: HeartbeatSession,
  ): AsyncIterable<AgentRuntimeEvent> {
    this.aborted = false;
    this.activeSession = session;

    let modelRecycle = false;
    try {
      modelRecycle = session.ensure(input.model, input.systemPrompt, input.effort || 'adaptive');
    } catch (err) {
      yield { type: 'error', message: `heartbeat session failed to start: ${err instanceof Error ? err.message : String(err)}` };
      return;
    }

    // Supervisor incidents (refusal crash-loops, mid-session refusal
    // detections) become visible system lines in this thread — dead air
    // is the bug, not the refusal itself. The three backoffs (cap, login,
    // refused model) reach the thread ONCE per outage, whichever lane hits
    // them first; the repeats stay in the log (outage-notices.ts).
    session.onIncident = (text, outage) => {
      if (outage && !outageNotices.shouldPost(outage, session.key, this.options.threadId ?? '')) return;
      this.postSystemLine(text);
    };

    // Model change: the old session is being torn down. Hold this turn until
    // the NEW session has launched — appending to the inbox now would let the
    // dying session's hook consume the message (advancing the shared inbox
    // offset), leaving the fresh session with nothing to answer and the turn
    // dead on the 300s timeout.
    if (modelRecycle) {
      const note = `[Model changed to ${input.model} — recycling the warm session before delivering this message…]`;
      yield { type: 'thinking_delta', text: note };
      yield { type: 'thinking_end', fullText: note };
      const relaunched = await session.waitForRelaunch();
      if (!relaunched) {
        const warn = '[Recycle is taking longer than expected — delivering the message anyway; it will be picked up when the session comes back.]';
        yield { type: 'thinking_delta', text: warn };
        yield { type: 'thinking_end', fullText: warn };
      }
    }

    const state = laneStateFor(key, session);
    const fresh = session.consumeFreshFlag();
    if (!fresh) {
      const room = (session as any).currentSessionId as string | null | undefined;
      let marksRoom = '';
      try { marksRoom = readFileSync(join(session.dir, 'io', ROOM_WATERMARK_FILE), 'utf8').trim(); } catch { /* none yet */ }
      if (room && marksRoom && marksRoom !== room) {
        // Too much, never nothing: a reopened room that missed another room's
        // hour is handed the window rather than an empty diff.
        state.lastTurnAt = undefined;
        state.lastHandedUserAt = undefined;
      }
    }
    if (fresh) {
      // A truncated outbox would make a stale offset read garbage, so the
      // offsets clamp. The owed-turn ledger does NOT clear: the CLI relaunch
      // RESUMES the transcript, so a session killed mid-turn (API 529, a
      // watchdog reap) comes back, finishes the thought it was holding and
      // writes that line to the outbox minutes later. Clearing the ledger here
      // threw away the only ticket that line had — the sweep below read it,
      // found no owed turn, skipped it and advanced past it, so a finished
      // reply was unrecoverable. Stale ids age out on their own at
      // MAX_UNRESOLVED; delivery still requires a real matching outbox line.
      state.consumedOffset = Math.min(state.consumedOffset, session.outboxSize());
      state.activityOffset = Math.min(state.activityOffset, session.activitySize());
    }
    const contextBlock = fresh ? await this.buildRecycleContext() : '';
    // A wake into a warm-but-absent lane: hand it what the room said while it
    // was quiet. A live turn gets the same, bounded at the owner's arriving
    // message — it used to get nothing, so a wake that rang in ANOTHER lane
    // under this companion's own header was invisible to it: once a spontaneous
    // bell painted the whole cast from the shared lane, and every warm lane met
    // that picture secondhand, through the owner, not through the room.
    // Fires even with no mark. `!fresh` together with an unknown lastTurnAt is
    // exactly one situation — a room reopened by --resume after a backend
    // restart, before this lane has written its first stamp — and that room is
    // stale by construction. Handing it the bounded window may duplicate what
    // it already holds; handing it nothing is the hole. Same one-way doctrine
    // as the handover watermark: too much, never nothing.
    const catchUpBlock = fresh
      ? ''
      : this.buildCatchUpBlock(state.lastTurnAt, input.isAutonomous ? undefined : { prompt: input.prompt });

    // Runs on every turn, autonomous or not — the seam it closes is exactly
    // the one a wake opens, and a live turn is the next chance to notice.
    const missedBlock = this.buildMissedInboundBlock(state, input.prompt, fresh);

    // Surface the recycle seam in the UI — the warm session restarted and
    // is being re-primed, which is otherwise invisible to the user.
    if (fresh) {
      const note = `[Session recycled — warm CLI session restarted; re-primed with the last ${this.options.historyLimit || 30} messages of this thread.]`;
      yield { type: 'thinking_delta', text: note };
      yield { type: 'thinking_end', fullText: note };
    }

    const turnId = randomUUID().slice(0, 8);
    const images = this.writeImages(session, input.imageBlocks);

    let emittedText = false;
    // Pieces landing in the SAME message are separated by a blank line. A
    // mid-turn break starts a fresh message, so the separator resets with it —
    // otherwise every bubble after the first would open on blank lines.
    let textInOpenMessage = false;
    const joined = (content: string) => (textInOpenMessage ? '\n\n' + content : content);

    // Never-drop-late: sweep outbox lines written since the last turn ended.
    // Replies that belong to timed-out turns are delivered now, ahead of the
    // new reply, instead of being silently skipped.
    {
      const swept = session.readOutboxFrom(state.consumedOffset);
      state.consumedOffset = swept.newOffset;
      const late: { content: string; thinking: string | null; payload: any }[] = [];
      // Collect ALL lines belonging to unresolved turns before removing turn_ids
      // from the ledger — a multi-chunk reply may have several lines with the
      // same turn_id, and we need to deliver all of them.
      const matchedTurnIds = new Set<string>();
      for (const line of swept.lines) {
        for (const parsed of parseOutboxLine(line, (fragment, error) => {
          console.error(`[InteractiveCli] UNREADABLE OUTBOX LINE while sweeping late replies (a reply may be lost): ${error} :: ${fragment.slice(0, 160)}`);
        })) {
          const content = typeof parsed.content === 'string' ? parsed.content : null;
          if (!content) continue;
          const tid = typeof parsed.turn_id === 'string' ? parsed.turn_id : null;
          const owed = tid ? state.unresolved.includes(tid) : state.unresolved.length > 0;
          if (!owed) {
            if (!isHeartbeatSilenceSentinel(content)) {
              recordOrphanedReply(session.orphanedRepliesPath, tid, content);
            }
            continue;
          }
          if (tid) matchedTurnIds.add(tid);
          if (isHeartbeatSilenceSentinel(content)) continue;
          late.push({
            content,
            thinking: typeof parsed.thinking === 'string' && parsed.thinking.trim() ? parsed.thinking : null,
            payload: parsed,
          });
        }
      }
      // Now remove matched turn_ids from unresolved (after collecting all their lines)
      for (const tid of matchedTurnIds) {
        state.unresolved = state.unresolved.filter((t) => t !== tid);
      }
      // For lines without turn_id, assume oldest unresolved
      if (late.length > 0 && matchedTurnIds.size === 0 && state.unresolved.length > 0) {
        state.unresolved.shift();
      }
      if (late.length > 0) {
        const note = `[Late repl${late.length === 1 ? 'y' : 'ies'} from an earlier turn that outran its window — delivered now, ahead of the current reply.]`;
        yield { type: 'thinking_delta', text: note };
        yield { type: 'thinking_end', fullText: note };
        for (const l of late) {
          if (l.thinking) {
            yield { type: 'thinking_delta', text: l.thinking };
            yield { type: 'thinking_end', fullText: l.thinking };
          }
          yield* this.attachmentEvents(l.payload);
          yield { type: 'text_delta', text: joined(l.content) };
          emittedText = true;
          textInOpenMessage = true;
          // Each late reply closes as its OWN message. It used to be yielded into the
          // same open message as the turn that carried it out, so an answer from an
          // earlier turn and the answer to the current one arrived glued together in
          // one bubble with two visible seams. They are separate replies, written
          // minutes apart, to different messages — they should look it.
          yield { type: 'message_break' };
          textInOpenMessage = false;
        }
      }
    }

    // Stamp the user-visible time label in the configured timezone — the
    // hook has no tz config, so a raw `ts` would render in server time (UTC).
    let timeLabel: string | undefined;
    try { timeLabel = localStamp(getAerieConfig().identity.timezone); } catch { /* config not loaded */ }

    // Tool activity from between turns (idle-tick work) isn't this turn's —
    // fast-forward so the live tool feed below only shows what THIS turn does.
    state.activityOffset = session.activitySize();

    // Ambient recall (The Whisper): archived Cortex memories resembling this
    // message ride in ahead of it — recall without asking. Timeboxed and
    // fail-quiet; a slow Cortex never delays delivery past its budget.
    const whisperBlock = await ambientRecall(input.prompt, key, fresh);

    // The Archivist's noticings, handed over rather than written onto the walls.
    // Same quiet channel as recall — deliberately not gated on Cortex, so the
    // companions still get them when ambient recall is off or unreachable.
    let unfiledBlock = '';
    try { unfiledBlock = unfiledNoticings(); } catch { /* never delay a turn */ }

    // Side notes sent while the last turn was working. The session may read
    // them live from io/side-notes.jsonl, but nothing guarantees it looked —
    // so whatever is still unread is handed over here. Late, never lost.
    let sideNoteBlock = '';
    try {
      const pending = session.readSideNotesFrom(state.sideNotesOffset);
      state.sideNotesOffset = pending.newOffset;
      if (pending.notes.length > 0) {
        // The session may have read a note live and already answered it. That
        // never suppresses the handover — the whole worth of this path is that
        // the owner's note does not depend on the session's judgement — but it should
        // not come back dressed as unread either, or the session repeats
        // itself and the owner cannot tell an echo from a miss. So: hand over every
        // note exactly as before, and label the ones it says it already had.
        // ISO-8601 UTC stamps compare lexicographically; an empty stamp on
        // either side means no claim, which reads as unseen.
        // Isolated on purpose: the label is a nicety, the handover is the
        // guarantee, and the nicety must never be able to take the guarantee
        // down with it. Anything that goes wrong reading the mark degrades to
        // an empty mark — every note unlabelled, i.e. exactly the old behaviour.
        let readMark = '';
        try { readMark = session.sideNotesReadMark?.() ?? ''; } catch { readMark = ''; }
        const alreadySeen = (at: string): boolean => Boolean(readMark && at && at <= readMark);
        const lines = pending.notes
          .map((note) => `- ${note.text}${alreadySeen(note.at) ? '  [you picked this up live — already answered, no need to repeat it]' : ''}`)
          .join('\n');
        const anyUnseen = pending.notes.some((note) => !alreadySeen(note.at));
        const header = anyUnseen
          ? '[Sent to you while you were working and not read at the time — answer these too:]'
          : '[Sent to you while you were working — you already picked these up live, so they are here for the record only:]';
        sideNoteBlock = `${header}\n${lines}\n\n`;
      }
    } catch { /* a missing or unreadable file must never delay the turn */ }

    session.appendInbox({
      ts: new Date().toISOString(),
      ...(timeLabel ? { time: timeLabel } : {}),
      channel: 'aerie',
      author: this.options.userName || 'user',
      content: contextBlock + catchUpBlock + missedBlock + whisperBlock + unfiledBlock + sideNoteBlock
        + roomVoicesBlock(this.options.roomVoices) + this.clampForInbox(input.prompt, 60_000),
      turn: turnId,
      ...(images.length > 0 ? { images } : {}),
      // Read by the Stop hook into io/.turn-audience, where the tool gate
      // looks before every tool call. See services/turn-audience.ts.
      ...(this.options.audience ? { audience: this.options.audience } : {}),
    });
    // The history block is now sitting in the inbox, so whichever session reads
    // it arrives primed — including a successor, when the session this turn
    // waited for dies at the door (a refused model guarantees exactly that).
    // Silence the next arming or that successor's own launch re-arms the flag
    // and the following turn draws a second chip for one live birth.
    if (fresh) session.markPrimedIntoInbox?.();

    const turnStartedAt = Date.now();
    // Gallery images this turn has already carried, so a recovery sweep after a
    // stall doesn't hand the same picture over a second time.
    const attachedGalleryFiles = new Set<string>();
    let deadline = turnStartedAt + REPLY_TIMEOUT_MS;
    let offset = state.consumedOffset;
    let chunks = 0;
    let activitySeq = 0;
    // Synthesized tool-use ids per tool name, for hook payloads without one.
    const pendingTools: Record<string, string[]> = {};
    // Tool calls that have started and not yet reported back.
    const openTools = new Set<string>();
    // Recycle detection: if the session reads CLAUDE.md, it just recycled —
    // emit a recycle notice and skip the compaction warning for this turn.
    let sawRecycle = false;
    const claudeMdPath = join(session.dir, 'CLAUDE.md');

    /**
     * Which spawn this turn is speaking into.
     *
     * The symptom: the turn's tool calls finished, and then it sat silent
     * until it timed out. A mid-turn relaunch ALWAYS mints a new
     * conversation — shouldResumeLaunch only lets the first launch of a
     * backend process reopen a room — so the session now running was handed
     * the launch prompt, not the owner's message, and that prompt tells it in as many
     * words to WAIT SILENTLY and not write to the outbox until a real turn_id
     * arrives. Two correct behaviours pointed straight at each other: a turn
     * waiting for a line, and a room under written instruction not to write
     * one. The only possible outcome was the full window.
     */
    const launchGeneration = session.launchGeneration;
    let relaunchedMidTurn = false;

    while (Date.now() < deadline) {
      // Checked first: nothing this loop does afterwards can be answered by a
      // room that is no longer there, and the old turn id went with it.
      if (session.launchGeneration !== launchGeneration) {
        relaunchedMidTurn = true;
        break;
      }
      if (this.aborted) {
        // Intentional retraction (message edit) — do NOT ledger this turn:
        // a late answer to a retracted message should stay retracted.
        state.consumedOffset = offset;
        yield { type: 'done', finishReason: 'aborted' };
        return;
      }
      if (session.status === 'unavailable') {
        state.consumedOffset = offset;
        yield { type: 'error', message: session.lastError || 'heartbeat session unavailable' };
        return;
      }

      // Tool-activity tail — surface the session's tool calls live, and treat
      // them as liveness: a session deep in tool work is not silent, so every
      // activity line re-arms the reply window just like a chunk does.
      {
        const act = session.readActivityFrom(state.activityOffset);
        state.activityOffset = act.newOffset;
        let sawActivity = false;
        for (const actLine of act.lines) {
          let ev: any;
          try { ev = JSON.parse(actLine); } catch { continue; }
          const tool = typeof ev.tool === 'string' && ev.tool ? ev.tool : 'tool';
          if (ev.phase === 'pre') {
            sawActivity = true;
            // Recycle detection: a Read of CLAUDE.md means the session just recycled.
            // (We track sawRecycle to skip compaction warnings, but don't broadcast —
            // the recycle badge on the message bubble is sufficient.)
            const detail = typeof ev.detail === 'string' && ev.detail ? ev.detail : '';
            if (!sawRecycle && tool === 'Read' && detail === claudeMdPath) {
              sawRecycle = true;
            }
            let id: string;
            if (typeof ev.id === 'string' && ev.id) {
              id = ev.id;
            } else {
              id = `cli-${turnId}-${activitySeq++}`;
              (pendingTools[tool] ||= []).push(id);
            }
            openTools.add(id);
            yield { type: 'tool_start', toolUseId: id, toolName: tool, input: detail ? { detail } : {} };
          } else if (ev.phase === 'post') {
            sawActivity = true;
            const id = typeof ev.id === 'string' && ev.id ? ev.id : pendingTools[tool]?.shift();
            if (id) {
              openTools.delete(id);
              yield { type: 'tool_result', toolUseId: id, toolName: tool, output: '', isError: false };
            }
          }
        }
        if (sawActivity) deadline = Date.now() + REPLY_TIMEOUT_MS;
      }

      // Work still in hand: a tool that started and hasn't reported back is
      // demonstrably running, not silent. One command that blocks for twenty
      // minutes only pings once — at the start — so without this the window
      // would close on a session that is visibly mid-task. Bounded by the same
      // per-turn cap as io/.busy, so a tool that never returns can't zombie a
      // turn. This is what makes long foreground work safe without anyone
      // having to estimate how long it will take.
      if (openTools.size > 0 && Date.now() - turnStartedAt < WORKING_MAX_MS) {
        const held = Date.now() + REPLY_TIMEOUT_MS;
        if (held > deadline) deadline = held;
      }

      // Declared background work: a fresh io/.busy re-arms the window each
      // poll while the flag stays fresh (see BUSY_FRESH_MS/WORKING_MAX_MS above).
      {
        const busy = session.busyMtime();
        if (
          busy > 0 &&
          Date.now() - busy < BUSY_FRESH_MS &&
          Date.now() - turnStartedAt < WORKING_MAX_MS
        ) {
          const held = Date.now() + REPLY_TIMEOUT_MS;
          if (held > deadline) deadline = held;
        }
      }

      const { lines, newOffset } = session.readOutboxFrom(offset);
      offset = newOffset;
      let fallback: { content: string; thinking: string | null; more: boolean; payload: any | null } | null = null;
      let currentTurnPassedSilently = false;

      // parseOutboxLine recovers replies glued onto one line by a write that missed
      // its newline — that used to throw and take BOTH replies with it — and reports
      // anything genuinely unreadable instead of swallowing it. A dropped reply and a
      // slow one look identical from the owner's side, so silence here is the expensive kind.
      const parsedLines: { parsed: any; line: string }[] = [];
      for (const line of lines) {
        const objs = parseOutboxLine(line, (fragment, error) => {
          console.error(`[InteractiveCli] UNREADABLE OUTBOX LINE (a reply may be lost): ${error} :: ${fragment.slice(0, 160)}`);
        });
        if (objs.length === 0) {
          // Nothing readable at all — keep the old behaviour of offering the raw line
          // rather than nothing, but now it has been logged on the way past.
          if (chunks === 0) fallback = { content: line, thinking: null, more: false, payload: null };
          continue;
        }
        for (const parsed of objs) parsedLines.push({ parsed, line });
      }

      for (const { parsed } of parsedLines) {
        const content = typeof parsed.content === 'string' ? parsed.content : null;
        if (!content) continue;
        const thinking = typeof parsed.thinking === 'string' && parsed.thinking.trim()
          ? parsed.thinking
          : null;
        const tid = typeof parsed.turn_id === 'string' ? parsed.turn_id : null;
        const more = parsed.more === true;
        const silenceSentinel = isHeartbeatSilenceSentinel(content);

        // Our reply — or a continuation chunk whose turn_id the model dropped.
        if (tid === turnId || (tid === null && chunks > 0)) {
          // Filter the sentinel while it is still associated with its own
          // outbox line. Waiting until the router joins all deltas leaks it
          // whenever a late reply and a quiet current wake share one batch.
          if (silenceSentinel) {
            currentTurnPassedSilently = true;
            continue;
          }
          if (thinking) {
            yield { type: 'thinking_delta', text: thinking };
            yield { type: 'thinking_end', fullText: thinking };
          }
          yield* this.attachmentEvents(parsed, attachedGalleryFiles);
          yield { type: 'text_delta', text: joined(content) };
          emittedText = true;
          textInOpenMessage = true;
          chunks++;
          if (more) {
            // Close this chunk as its own message so it reaches the room now,
            // rather than sitting behind a scratchpad until the turn ends.
            yield { type: 'message_break' };
            textInOpenMessage = false;
            deadline = Date.now() + REPLY_TIMEOUT_MS; // every chunk re-arms the window
            continue;
          }
          state.consumedOffset = offset;
          state.silentTimeouts = 0;
          session.clearBusy();
          yield* this.emitContextUsage();
          yield { type: 'done', finishReason: 'complete' };
          return;
        }

        if (tid !== null) {
          // A different turn_id: if it's a turn we timed out on, deliver it
          // late rather than dropping it; anything else is stale — skip.
          if (state.unresolved.includes(tid)) {
            // Pay the ledger on the FINAL chunk only. A late reply is as likely
            // to be five lines as one, and clearing the entry on the first of
            // them made every chunk after it read as owed to nobody and go
            // straight to the orphan file — five messages written, one
            // delivered.
            // The pre-turn sweep already collects a whole reply before clearing
            // (see the comment there); this is that same rule on the live path.
            // A late reply that never sends its final chunk leaves the entry
            // behind, which costs one extra delivery attempt and never a drop.
            if (!more) state.unresolved = state.unresolved.filter((t) => t !== tid);
            // A late deliberate silence pays the unresolved ledger without
            // becoming text or donating its thought card to the next turn.
            if (silenceSentinel) continue;
            if (thinking) {
              yield { type: 'thinking_delta', text: thinking };
              yield { type: 'thinking_end', fullText: thinking };
            }
            yield* this.attachmentEvents(parsed);
            yield { type: 'text_delta', text: joined(content) };
            emittedText = true;
            textInOpenMessage = true;
            // Close it as its own message, exactly as the pre-turn sweep does —
            // a reply written minutes ago to a different owner message should
            // not arrive glued to the one being written now.
            yield { type: 'message_break' };
            textInOpenMessage = false;
          } else if (!silenceSentinel) {
            // Not owed, so it was written after that turn's final line. Same loss
            // as the pre-turn sweep, same reason it went unnoticed for months: it
            // skipped here with a bare continue and left no trace at all.
            recordOrphanedReply(session.orphanedRepliesPath, tid, content);
          }
          continue;
        }

        // No turn_id before any chunk landed (model forgot) — usable if
        // nothing better shows up in this batch.
        fallback = { content, thinking, more, payload: parsed };
      }

      if (currentTurnPassedSilently) {
        state.consumedOffset = offset;
        state.silentTimeouts = 0;
        session.clearBusy();
        yield* this.emitContextUsage();
        // Deliberate silence, reported as such — the sentinel was filtered
        // above, so the reason is all the router gets to go on.
        yield { type: 'done', finishReason: 'silent' };
        return;
      }

      if (fallback !== null && chunks === 0) {
        if (isHeartbeatSilenceSentinel(fallback.content)) {
          state.consumedOffset = offset;
          state.silentTimeouts = 0;
          session.clearBusy();
          yield* this.emitContextUsage();
          yield { type: 'done', finishReason: 'silent' };
          return;
        }
        if (fallback.thinking) {
          yield { type: 'thinking_delta', text: fallback.thinking };
          yield { type: 'thinking_end', fullText: fallback.thinking };
        }
        if (fallback.payload) yield* this.attachmentEvents(fallback.payload, attachedGalleryFiles);
        yield { type: 'text_delta', text: joined(fallback.content) };
        emittedText = true;
        textInOpenMessage = true;
        chunks++;
        if (fallback.more) {
          yield { type: 'message_break' };
          textInOpenMessage = false;
          deadline = Date.now() + REPLY_TIMEOUT_MS;
        } else {
          state.consumedOffset = offset;
          state.silentTimeouts = 0;
          session.clearBusy();
          yield* this.emitContextUsage();
          yield { type: 'done', finishReason: 'complete' };
          return;
        }
      }

      await sleep(POLL_MS);
    }

    // Window closed on sustained silence — or the room went out from under
    // this turn. Ledger the turn so its reply is delivered with the next turn
    // instead of dropped.
    state.consumedOffset = offset;
    state.unresolved.push(turnId);
    if (state.unresolved.length > MAX_UNRESOLVED) state.unresolved.shift();

    if (emittedText) {
      // Something already reached the UI — end the turn gracefully; the
      // remainder arrives with the next message via the ledger.
      state.silentTimeouts = 0; // chunks flowed — the session can speak
      // The stall may have caught a turn holding a finished picture. Carry it
      // out now rather than leaving it in the gallery for nobody.
      const recovered = yield* this.orphanedStudioImages(turnStartedAt, attachedGalleryFiles);
      const why = relaunchedMidTurn
        ? 'The warm session was replaced mid-delivery'
        : `Reply window closed after ${REPLY_TIMEOUT_MS / 1000}s of silence mid-delivery`;
      const note = recovered
        ? `[${why}. This turn had already finished an image — attached here rather than regenerated. Any remaining chunks will arrive with the next message.]`
        : `[${why} — any remaining chunks will arrive with the next message.]`;
      yield { type: 'thinking_delta', text: note };
      yield { type: 'thinking_end', fullText: note };
      yield* this.emitContextUsage();
      yield { type: 'done', finishReason: 'complete' };
      return;
    }

    // Nothing reached the owner at all, so the message this turn was carrying was
    // never answered — and the net has already stepped past it. Put the mark
    // back where it stood when this turn began so the next one hands it over
    // and writes a row for it. One-way, as ever: twice rather than never.
    const restored = rollbackHandedWatermark(
      state,
      join(PROJECT_ROOT, 'data', 'heartbeat', key, 'io', HANDED_WATERMARK_FILE),
    );
    if (this.options.threadId && state.threadHandedAdvancedAt) {
      restoreThreadHandedWatermark(
        threadHandedWatermarkPath(
          join(PROJECT_ROOT, 'data', 'heartbeat'),
          key,
          this.options.threadId,
        ),
        state.threadHandedBeforeTurn,
        state.threadHandedAdvancedAt,
      );
    }
    state.threadHandedBeforeTurn = undefined;
    state.threadHandedAdvancedAt = undefined;

    // The room went out from under this turn. Say so and stop — do NOT spend
    // the rest of the window, and do NOT count it toward the mute-zombie
    // heuristic below: this silence is fully explained, and the session now
    // running is a brand new one that has done nothing wrong. Counting it
    // would answer a crash by recycling the room that replaced it.
    if (relaunchedMidTurn) {
      state.silentTimeouts = 0;
      yield {
        type: 'error',
        message: 'the warm session was replaced while this turn was open, so the room it was speaking into is gone — a mid-turn relaunch always starts a new conversation, and the new one was handed its launch prompt rather than this message.'
          + (restored ? ' Nothing was said, so the handover mark was rewound and the message goes to the next turn.' : '')
          + ` Session status: ${session.status}${session.lastError ? ` (${session.lastError})` : ''}.`,
        code: 'heartbeat_session_replaced',
      };
      return;
    }

    // Fully silent turn: no chunks AND no tool activity for the whole window.
    // One could be a stall; two in a row is the mute-zombie shape from the
    // 2026-06-12 outage — a session whose every reply is being refused can
    // tick forever without speaking. Recycle it with a thinned seed.
    state.silentTimeouts++;
    let recycleNote = '';
    if (state.silentTimeouts >= 2) {
      state.silentTimeouts = 0;
      session.requestRestart();
      recycleNote = ' Two consecutive turns were fully silent — recycling the warm session.';
    }

    yield {
      type: 'error',
      message: `heartbeat reply timeout after ${REPLY_TIMEOUT_MS / 1000}s — if the reply lands late it will be delivered with the next message.${restored ? ' Nothing was said, so the handover mark was rewound and the owner\'s message goes back to the next turn.' : ''}${recycleNote} Session status: ${session.status}${session.lastError ? ` (${session.lastError})` : ''}. Check data/heartbeat/${key}/session.log`,
      code: 'heartbeat_timeout',
    };
  }
}
