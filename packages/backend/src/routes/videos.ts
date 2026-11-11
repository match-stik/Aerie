// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Videos the house keeps (services/video-room.ts): drop a link, the house
// fetches it. They live in the Screening Room's Videos tab (theirs, Nov 11 2026:
// 'a separate player ... It just kind of aggressively snaps you in here'), with
// a player and a table of their own, so a show on Now showing is never touched.
// A short one is watched whole the moment it lands; for a longer one, what they
// say carries where their player is, and the turn gets only what has played.
import crypto from 'crypto';
import { Router } from 'express';
import { existsSync } from 'fs';
import type { AgentService } from '../services/agent.js';
import { authMiddleware } from '../middleware/auth.js';
import { assignCompanionToThread, listCompanions } from '../services/db/companions.js';
import { createMessage, getMessages } from '../services/db/messages.js';
import { getDb } from '../services/db/state.js';
import { createThread, getThread } from '../services/db/threads.js';
import { registry } from '../services/ws.js';
import { isPublicUrl } from '../services/public-fetch.js';
import { ownerDisplayName } from '../services/db/owner-name.js';
import { addVideo, describeVideo, describeVideoAt, fetchVideo, framePaths, getVideo, listVideos, videoFile, videoUrl, type Video } from '../services/video-room.js';

/** Up to this long a video is watched whole the moment it lands; longer ones play on the clock. */
export const WHOLE_WATCH_SECONDS = 180;

const router = Router();
router.use(authMiddleware);

const THREAD_KEY = 'videos.thread_id';
const TABLE = 'videos';

export function videosThreadId(): string {
  const row = getDb().prepare('SELECT value FROM config WHERE key = ?').get(THREAD_KEY) as { value: string } | undefined;
  if (row?.value && getThread(row.value)) return row.value;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  createThread({ id, name: 'The Video Room', type: 'named', createdAt: now, sessionType: 'v2' });
  // Participants, no primary: a named leader would hand the room its own cold lane.
  for (const companion of listCompanions()) assignCompanionToThread(id, companion.id, 'participant', true);
  getDb().prepare('UPDATE threads SET archived_at = ? WHERE id = ?').run(now, id);
  getDb().prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(THREAD_KEY, id);
  createMessage({ id: crypto.randomUUID(), threadId: id, role: 'system', content: 'The Video Room opened. Bring us something.', platform: 'api', createdAt: now });
  return id;
}

function say(text: string): void {
  createMessage({ id: crypto.randomUUID(), threadId: videosThreadId(), role: 'system', content: text, platform: 'api', createdAt: new Date().toISOString() });
  registry.broadcast({ type: 'card_table_update', tableId: TABLE });
}

const present = (v: Video) => ({
  id: v.id, url: v.url, note: v.note, title: v.title, uploader: v.uploader, durationS: v.durationS,
  status: v.status, error: v.error, createdAt: v.createdAt,
  hasVideo: v.status === 'ready' && !!videoFile(v.id),
  hasThumb: framePaths(v.id).length > 0,
});

router.get('/', (_req, res) => {
  res.json({ videos: listVideos().map(present) });
});

let talking = false;
let talkError: string | null = null;

function companionTurn(agentService: AgentService, prompt: string): void {
  talking = true;
  talkError = null;
  registry.broadcast({ type: 'card_table_update', tableId: TABLE });
  setImmediate(() => {
    void (async () => {
      try {
        await agentService.processMessage(videosThreadId(), prompt, { name: 'The Video Room', type: 'named' }, { platform: 'api' });
      } catch (caught) {
        console.error('[Videos] Companion turn failed:', caught);
        talkError = 'The line to the room dropped. Say something else to call them back.';
      } finally {
        talking = false;
        registry.broadcast({ type: 'card_table_update', tableId: TABLE });
      }
    })();
  });
}

const preamble = () => [
  '[THE SCREENING ROOM, VIDEOS — watching together]',
  `The Videos tab of the Screening Room: ${ownerDisplayName()} brought a video (a TikTok, a YouTube video, a reel) and it plays in the room, and the companions watch it with them. Stay in character and answer naturally.`,
  'This is a watching turn, not a software task. Do not inspect or edit code.',
  'Look at every frame you are given before you answer, with the Read tool, so you are reacting to what is actually in it, not to its title.',
  'Your final spoken reply is written into the Videos table talk automatically.',
  'Use the normal bold sigil headers. React the way you would beside them on the couch, each of you noticing something different.',
];

router.post('/', async (req, res) => {
  const agentService = req.app.locals.agentService as AgentService | undefined;
  const url = videoUrl(req.body?.url);
  if (!url) { res.status(400).json({ error: 'Paste a link to the video' }); return; }
  // yt-dlp fetches whatever it is handed, so a link to this box or the home
  // network never reaches it (the same public-address check every fetch uses).
  // yt-dlp follows redirects itself, so this closes the plain case, not every one.
  if (!(await isPublicUrl(url))) { res.status(400).json({ error: 'That link points inside the house, not out to the web' }); return; }
  const note = typeof req.body?.note === 'string' && req.body.note.trim() ? req.body.note.trim().slice(0, 1000) : null;
  const video = addVideo(url, note);
  createMessage({
    id: crypto.randomUUID(), threadId: videosThreadId(), role: 'user', content: note ? `${note}\n${url}` : url, platform: 'api',
    metadata: { room: 'videos', videoId: video.id }, createdAt: new Date().toISOString(),
  });
  registry.broadcast({ type: 'card_table_update', tableId: TABLE });
  res.status(202).json({ video: present(video) });
  void fetchVideo(video.id).then((done) => {
    registry.broadcast({ type: 'card_table_update', tableId: TABLE });
    if (!done) return;
    if (done.status !== 'ready') {
      say(`That one would not come through: ${done.error ?? 'the fetch failed'}.`);
      return;
    }
    if ((done.durationS ?? 0) > WHOLE_WATCH_SECONDS) {
      say(`${done.title || 'The video'} is on the shelf. Press play when you're ready, and talk to us as it goes.`);
      return;
    }
    if (!agentService) return;
    companionTurn(agentService, [
      ...preamble(),
      '',
      `${ownerDisplayName(true)} just brought you this one:`,
      describeVideo(done),
      note ? `\n${ownerDisplayName(true)} said with it: ${note}` : '',
    ].filter((l) => l !== '').join('\n'));
  });
});

router.get('/:id/video', (req, res) => {
  try {
    const file = videoFile(req.params.id);
    if (!file) { res.status(404).json({ error: 'No video' }); return; }
    res.sendFile(file);
  } catch {
    res.status(404).json({ error: 'No video' });
  }
});

router.get('/:id/thumb', (req, res) => {
  try {
    const frames = framePaths(req.params.id);
    const pick = frames[Math.min(1, frames.length - 1)];
    if (!pick || !existsSync(pick)) { res.status(404).json({ error: 'No picture' }); return; }
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.sendFile(pick);
  } catch {
    res.status(404).json({ error: 'No picture' });
  }
});

router.get('/rail', (_req, res) => {
  const threadId = videosThreadId();
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

router.post('/chat', (req, res) => {
  const agentService = req.app.locals.agentService as AgentService | undefined;
  if (!agentService) { res.status(503).json({ error: 'The companion lane is not available' }); return; }
  const content = String(req.body?.content ?? '').trim();
  if (!content) { res.status(400).json({ error: 'Say something into the room first' }); return; }
  if (talking) { res.status(409).json({ error: 'They are already talking' }); return; }
  const threadId = videosThreadId();
  createMessage({
    id: crypto.randomUUID(), threadId, role: 'user', content, platform: 'api',
    metadata: { room: 'videos' }, createdAt: new Date().toISOString(),
  });
  res.status(202).json({ ok: true });
  // The video they have on their player, and where it is: the turn gets what has played and no more.
  const { videoId, positionMs } = req.body || {};
  let video: Video | null = null;
  try { video = typeof videoId === 'string' && videoId ? getVideo(videoId) : null; } catch { video = null; }
  if (!video) video = listVideos(20).find((v) => v.status === 'ready') ?? null;
  const at = typeof positionMs === 'number' && Number.isFinite(positionMs) ? positionMs : null;
  const long = (video?.durationS ?? 0) > WHOLE_WATCH_SECONDS;
  companionTurn(agentService, [
    ...preamble(),
    '',
    !video || video.status !== 'ready'
      ? 'No video is on their player right now.'
      : long && at !== null ? `The video on their player:\n${describeVideoAt(video, at)}` : `The video on their player:\n${describeVideo(video)}`,
    '',
    `${ownerDisplayName(true)} just said this to you, and it is what you are answering:`,
    content,
  ].join('\n'));
});

export default router;
