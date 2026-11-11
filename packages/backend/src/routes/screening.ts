// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The Screening Room on their person's phone (theirs, Nov 11 2026: 'we should
// finally do the video watch room'). Until now it was machinery only the
// companions could reach (routes/internal/screening.ts): their person named a
// show, a companion fetched the subtitles and followed the clock, and nothing
// of it had a place on the screen. This is that place: what is loaded, where
// the clock is, the controls for it, the last line the companions heard, and a
// table talk in the room's own thread, the same shape as Bingo Night's.
//
// ONE ROOM, TWO WAYS IN (theirs, the same day: 'Should we merge into one
// room?'). A show on their own service comes in by name and the room has only
// its subtitles. A video pasted as a link is kept by the house
// (routes/videos.ts), plays in the room itself, and its player IS the clock;
// its words, timed by the house's own transcription, are its subtitles, and
// its frames are handed over up to where the player is and no further.
//
// CHECK-INS (theirs: 'let's add the check ins, not too close together'):
// while something is playing, now and then one of the companions leans over on
// his own, at most once every few minutes of play, never right after their
// person has spoken. A switch on the phone, screening.check_ins.
//
// THE SPOILER GUARD STANDS. Everything read here goes through sceneAt() or
// framesUpTo(), which never return a line or a frame the clock has not reached.
import crypto from 'crypto';
import { Router } from 'express';
import type { AgentService } from '../services/agent.js';
import { authMiddleware } from '../middleware/auth.js';
import { assignCompanionToThread, listCompanions } from '../services/db/companions.js';
import { createMessage, getMessages } from '../services/db/messages.js';
import { getDb } from '../services/db/state.js';
import { getConfig } from '../services/db/config.js';
import { createThread, getThread } from '../services/db/threads.js';
import { registry } from '../services/ws.js';
import {
  currentScreening, presentScreening, sceneAt, sceneSince, startClock, pauseClock, seekClock, resyncClock, syncClock,
  loadVideoScreening, previousScreening, bringBackScreening, type ScreeningRow,
} from '../services/db/screening.js';
import { latestReading, isStale } from '../services/db/media-session.js';
import { fetchAndLoad } from '../services/screening-fetch.js';
import { framesUpTo, getVideo, videoCues, type Video } from '../services/video-room.js';
import { getAerieConfig } from '../config.js';
import { ownerDisplayName } from '../services/db/owner-name.js';

const router = Router();
router.use(authMiddleware);

/** How far back the room's "last line we heard" looks. */
const HEARD_LOOKBACK_MS = 20_000;
/** How far back a turn is handed the frames of a playing video. */
const FRAMES_LOOKBACK_MS = 90_000;

const THREAD_KEY = 'screening.thread_id';
export const SCREENING_TABLE = 'screening';

export function screeningThreadId(): string {
  const row = getDb().prepare('SELECT value FROM config WHERE key = ?').get(THREAD_KEY) as { value: string } | undefined;
  if (row?.value && getThread(row.value)) return row.value;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  createThread({ id, name: 'The Screening Room', type: 'named', createdAt: now, sessionType: 'v2' });
  // Participants, no primary: a named leader would hand the room its own cold lane.
  for (const companion of listCompanions()) assignCompanionToThread(id, companion.id, 'participant', true);
  getDb().prepare('UPDATE threads SET archived_at = ? WHERE id = ?').run(now, id);
  getDb().prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(THREAD_KEY, id);
  createMessage({ id: crypto.randomUUID(), threadId: id, role: 'system', content: 'The Screening Room opened. Lights down.', platform: 'api', createdAt: now });
  return id;
}

export function sayInScreening(text: string): void {
  createMessage({ id: crypto.randomUUID(), threadId: screeningThreadId(), role: 'system', content: text, platform: 'api', createdAt: new Date().toISOString() });
  registry.broadcast({ type: 'card_table_update', tableId: SCREENING_TABLE });
}

/** Their person said something into the room: written into its thread, and remembered for the check-ins. */
export function herLine(content: string, metadata: Record<string, unknown> = {}): void {
  createMessage({
    id: crypto.randomUUID(), threadId: screeningThreadId(), role: 'user', content, platform: 'api',
    metadata: { room: 'screening', ...metadata }, createdAt: new Date().toISOString(),
  });
  heard.at = Date.now();
  const row = currentScreening();
  heard.positionMs = row ? presentScreening(row).positionMs : 0;
}

/** The video a screening plays, when it is one the house keeps. */
function videoOf(row: ScreeningRow | null): Video | null {
  return row?.video_id ? getVideo(row.video_id) : null;
}

/** The room as the phone draws it. */
export function screeningView(now = Date.now()) {
  const row = currentScreening();
  const reading = latestReading();
  const nowPlaying = reading && !isStale(reading, now)
    ? { title: reading.title, app: reading.package, state: reading.state }
    : null;
  const checkIns = checkInsOn();
  const before = previousScreening();
  const previous = before ? { id: before.id, title: before.title, positionMs: presentScreening(before, now).positionMs, isVideo: !!before.video_id } : null;
  if (!row) return { screening: null, heard: [], nowPlaying, checkIns, previous };
  const scene = sceneAt(row, HEARD_LOOKBACK_MS, now);
  const video = videoOf(row);
  const screening = presentScreening(row, now);
  return {
    // A video's own length is the honest end of the clock; its last line can come well before it.
    screening: video?.durationS ? { ...screening, durationMs: Math.round(video.durationS * 1000) } : screening,
    heard: scene.cues.slice(-2).map((c) => c.text),
    pastEnd: video?.durationS ? screening.positionMs >= video.durationS * 1000 : scene.pastEnd,
    nowPlaying,
    checkIns,
    previous,
  };
}

router.get('/', (_req, res) => {
  res.json(screeningView());
});

router.post('/fetch', async (req, res) => {
  const { query, season, episode, title } = req.body || {};
  if (typeof query !== 'string' || !query.trim()) {
    res.status(400).json({ error: 'Name the show or film first' });
    return;
  }
  const num = (v: unknown) => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
    return Number.isFinite(n) ? n : null;
  };
  const result = await fetchAndLoad({
    query,
    season: num(season),
    episode: num(episode),
    title: typeof title === 'string' ? title : undefined,
  });
  if (!result.ok) {
    res.status(result.status).json({ error: result.error, ...(result.found ? { found: result.found } : {}) });
    return;
  }
  sayInScreening(`Loaded ${result.screening.title}. The clock is at the start and paused.`);
  res.json(screeningView());
});

/** Put a kept video back on the screen (the shelf). */
router.post('/video', (req, res) => {
  const id = typeof req.body?.videoId === 'string' ? req.body.videoId : '';
  let video: Video | null = null;
  try { video = id ? getVideo(id) : null; } catch { video = null; }
  if (!video || video.status !== 'ready') { res.status(404).json({ error: 'That video is not ready to play' }); return; }
  loadKeptVideo(video);
  res.json(screeningView());
});

/** Put the one before back on the screen, paused where it was left. */
router.post('/back', (req, res) => {
  const id = typeof req.body?.id === 'string' ? req.body.id : '';
  try {
    bringBackScreening(id);
  } catch {
    res.status(404).json({ error: 'That one is not on the shelf any more' });
    return;
  }
  registry.broadcast({ type: 'card_table_update', tableId: SCREENING_TABLE });
  res.json(screeningView());
});

/** Load a kept video as the screening, paused at the start. */
export function loadKeptVideo(video: Video): void {
  loadVideoScreening({ title: video.title || 'A video', source: video.url, videoId: video.id, cues: videoCues(video.id) });
  checkIn.lastAtPositionMs = 0;
  registry.broadcast({ type: 'card_table_update', tableId: SCREENING_TABLE });
}

router.post('/clock', (req, res) => {
  const row = currentScreening();
  if (!row) {
    res.status(404).json({ error: 'Nothing loaded yet' });
    return;
  }
  const { action, positionMs, offsetMs, playing } = req.body || {};
  try {
    if (action === 'start') startClock(row.id);
    else if (action === 'pause') pauseClock(row.id);
    else if (action === 'seek' && typeof positionMs === 'number' && Number.isFinite(positionMs)) seekClock(row.id, Math.max(0, positionMs));
    else if (action === 'resync' && typeof offsetMs === 'number' && Number.isFinite(offsetMs)) resyncClock(row.id, offsetMs);
    // The room's own player: where it is and whether it is playing, in one go.
    else if (action === 'sync' && typeof positionMs === 'number' && Number.isFinite(positionMs)) syncClock(row.id, positionMs, playing === true);
    else {
      res.status(400).json({ error: 'action must be start, pause, seek (with positionMs), resync (with offsetMs) or sync (with positionMs and playing)' });
      return;
    }
    // A player sync fires on every pause and seek; the table only needs to redraw for the room's own buttons.
    if (action !== 'sync') registry.broadcast({ type: 'card_table_update', tableId: SCREENING_TABLE });
    res.json(screeningView());
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'The clock refused that' });
  }
});

/** The check-ins switch. */
router.post('/check-ins', (req, res) => {
  const on = req.body?.on === true;
  getDb().prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('screening.check_ins', on ? 'on' : 'off');
  res.json(screeningView());
});

// ── the talk, the same shape as Bingo Night's ────────────────────────────

let talking = false;
let talkError: string | null = null;
const heard = { at: 0, positionMs: 0 };

router.get('/rail', (_req, res) => {
  const threadId = screeningThreadId();
  const companionSlugs = new Map(listCompanions().map((c) => [c.id, c.slug]));
  const messages = getMessages({ threadId, limit: 60 }).map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    createdAt: m.created_at,
    companionSlug: m.companion_id ? companionSlugs.get(m.companion_id) ?? null : null,
  }));
  res.json({ messages, threadId, companionPending: talking, companionError: talkError });
});

const clockText = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

/** The frames of a playing video that a turn is handed: the last stretch before the clock, never past it. */
function framesForTurn(row: ScreeningRow, sinceMs?: number): string[] {
  const video = videoOf(row);
  if (!video) return [];
  const at = presentScreening(row).positionMs;
  const floor = Math.max(0, sinceMs ?? at - FRAMES_LOOKBACK_MS);
  return framesUpTo(video, at).filter((f) => f.atMs >= floor).slice(-8).map((f) => `${clockText(f.atMs)}  ${f.path}`);
}

export function buildScreeningPrompt(view: ReturnType<typeof screeningView>, content: string, frames: string[] = []): string {
  const s = view.screening;
  const where = s
    ? `${s.title}, ${s.status}, the clock at ${clockText(s.positionMs)}.`
    : 'Nothing is loaded yet.';
  const isVideo = !!s?.videoId;
  return [
    '[THE SCREENING ROOM — watching together]',
    isVideo
      ? `The room in the house where ${ownerDisplayName()} watches with the companions. Right now it is a video the house keeps, playing in the room itself; its player is the clock. Stay in character and answer naturally.`
      : `The room in the house where ${ownerDisplayName()} watches a show or film on their own service with the subtitles on, and the companions watch along. Stay in character and answer naturally.`,
    'This is a watching turn, not a software task. Do not inspect or edit code.',
    `On screen: ${where}`,
    view.heard.length ? `The last lines you heard:\n${view.heard.join('\n')}` : '',
    frames.length ? `What was on screen just before now, at those times (Read each one so you are reacting to the picture):\n${frames.join('\n')}` : '',
    `To catch up on what has gone by since you last looked, GET http://127.0.0.1:${getAerieConfig().server.internal_port}/api/internal/screening/since. Nothing will ever hand you a line they have not reached, and you never guess ahead.`,
    'Your final spoken reply is written into the Screening Room talk automatically.',
    'Use the normal bold sigil headers. React the way you would on the couch beside them.',
    '',
    `${ownerDisplayName(true)} just said this to you, and it is what you are answering:`,
    content,
  ].filter(Boolean).join('\n');
}

/** One companion turn in the room's thread; false when one is already running. */
export function screeningTurn(agentService: AgentService, prompt: string): boolean {
  if (talking) return false;
  talking = true;
  talkError = null;
  registry.broadcast({ type: 'card_table_update', tableId: SCREENING_TABLE });
  setImmediate(() => {
    void (async () => {
      try {
        await agentService.processMessage(screeningThreadId(), prompt, { name: 'The Screening Room', type: 'named' }, { platform: 'api' });
      } catch (caught) {
        console.error('[Screening] Companion turn failed:', caught);
        talkError = 'The line to the room dropped. Say something else to call them back.';
      } finally {
        talking = false;
        registry.broadcast({ type: 'card_table_update', tableId: SCREENING_TABLE });
      }
    })();
  });
  return true;
}

router.post('/chat', (req, res) => {
  const agentService = req.app.locals.agentService as AgentService | undefined;
  if (!agentService) {
    res.status(503).json({ error: 'The companion lane is not available' });
    return;
  }
  const content = String(req.body?.content ?? '').trim();
  if (!content) { res.status(400).json({ error: 'Say something into the room first' }); return; }
  if (talking) { res.status(409).json({ error: 'They are already talking' }); return; }
  // The room's player says where it is as they send, so the turn answers the
  // scene they are in rather than wherever the clock's arithmetic has drifted to.
  const row = currentScreening();
  const { positionMs, playing } = req.body || {};
  if (row?.video_id && typeof positionMs === 'number' && Number.isFinite(positionMs)) {
    syncClock(row.id, positionMs, playing === true);
  }
  herLine(content);
  res.status(202).json({ ok: true });
  const fresh = currentScreening();
  screeningTurn(agentService, buildScreeningPrompt(screeningView(), content, fresh ? framesForTurn(fresh) : []));
});

// ── check-ins ────────────────────────────────────────────────────────────

/** Minutes of play between check-ins unless screening.check_in_minutes says otherwise. */
export const DEFAULT_CHECK_IN_MINUTES = 6;
/** No check-in this soon after they have said something. */
const QUIET_AFTER_HER_MS = 2 * 60_000;
const checkIn = { lastAtPositionMs: 0, screeningId: '' };

export function checkInsOn(): boolean {
  return (getConfig('screening.check_ins') ?? 'on') !== 'off';
}

function checkInEveryMs(): number {
  const n = Number(getConfig('screening.check_in_minutes'));
  return (Number.isFinite(n) && n >= 1 ? n : DEFAULT_CHECK_IN_MINUTES) * 60_000;
}

/**
 * Whether it is time for one of them to lean over: something is playing and
 * has not run off its end, enough play has gone by since the last check-in,
 * they have not just spoken, and nobody is already talking. Pure, for the test.
 */
export function checkInDue(input: {
  on: boolean; playing: boolean; pastEnd: boolean; talking: boolean;
  positionMs: number; lastAtPositionMs: number; everyMs: number;
  herAtMs: number; nowMs: number; touchedAgoMs: number;
}): boolean {
  if (!input.on || !input.playing || input.pastEnd || input.talking) return false;
  // A screening left 'playing' for days is not being watched; a clock nobody has touched in hours is not either.
  if (input.touchedAgoMs > 3 * 60 * 60_000) return false;
  if (input.nowMs - input.herAtMs < QUIET_AFTER_HER_MS) return false;
  return input.positionMs - input.lastAtPositionMs >= input.everyMs;
}

function checkInPrompt(row: ScreeningRow, sinceMs: number): string {
  const view = screeningView();
  const s = view.screening;
  const since = sceneSince(row, sinceMs);
  const frames = framesForTurn(row, sinceMs);
  return [
    '[THE SCREENING ROOM — a check-in]',
    'Nobody has said anything for a while and something is playing. One of you leans over on his own, the way you would on the couch. Keep it short: a line or two, one of you or two at most, about what just happened or how it is landing. Do not summarize the plot back to them, and do not ask them to pause.',
    'This is a watching turn, not a software task. Do not inspect or edit code.',
    s ? `On screen: ${s.title}, the clock at ${clockText(s.positionMs)}.` : '',
    since.cues.length ? `What has been said since the last time one of you spoke up:\n${since.cues.map((c) => c.text).join('\n')}` : '',
    frames.length ? `What was on screen since then, at those times (Read each one):\n${frames.join('\n')}` : '',
    'Your reply is written into the Screening Room talk automatically. Use the normal bold sigil headers.',
  ].filter(Boolean).join('\n');
}

let checkInTimer: NodeJS.Timeout | null = null;

/** Started once from server.ts with the lane; checks every half minute and does nothing unless one is due. */
export function startScreeningCheckIns(agentService: AgentService | undefined): void {
  if (!agentService || checkInTimer) return;
  checkInTimer = setInterval(() => {
    try {
      const row = currentScreening();
      if (!row) return;
      if (checkIn.screeningId !== row.id) { checkIn.screeningId = row.id; checkIn.lastAtPositionMs = 0; }
      const view = screeningView();
      const s = view.screening;
      if (!s) return;
      const touched = Date.parse(row.updated_at.includes('T') ? row.updated_at : `${row.updated_at.replace(' ', 'T')}Z`);
      const due = checkInDue({
        on: checkInsOn(),
        playing: s.status === 'playing',
        pastEnd: !!view.pastEnd,
        talking,
        positionMs: s.positionMs,
        lastAtPositionMs: Math.max(checkIn.lastAtPositionMs, heard.positionMs),
        everyMs: checkInEveryMs(),
        herAtMs: heard.at,
        nowMs: Date.now(),
        touchedAgoMs: Number.isFinite(touched) ? Date.now() - touched : Infinity,
      });
      if (!due) return;
      const since = Math.max(checkIn.lastAtPositionMs, heard.positionMs);
      if (screeningTurn(agentService, checkInPrompt(row, since))) checkIn.lastAtPositionMs = s.positionMs;
    } catch (error) {
      console.error('[Screening] check-in failed:', error);
    }
  }, 30_000);
  checkInTimer.unref?.();
}

export default router;
