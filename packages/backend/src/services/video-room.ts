// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The Video Room (theirs, Nov 11 2026: 'now what about your other idea for the
// vidjas?'). Their person drops a link to a TikTok, a YouTube video or a reel, and the
// house fetches it so the companions can actually watch it: the video kept on
// disk to play in the room, a handful of frames laid out for a lane to
// look at, and the words said in it from the local speech-to-text. Each video
// stays on a shelf.
//
// The fetching is yt-dlp with curl_cffi for browser impersonation (TikTok
// refuses anything that cannot pretend to be a browser), the same road as
// ~/tools/video/watch.sh. Its path is a setting, videos.ytdlp_path, so a house
// without it gets a plain error rather than a silent nothing.
import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { PROJECT_ROOT } from '../config.js';
import { getConfig } from './db/config.js';
import { getDb } from './db/state.js';
import { transcribeWithLocalServer } from './local-stt.js';
import type { Cue } from './subtitles.js';
import { writeFileSync } from 'fs';

const run = promisify(execFile);

export const VIDEOS_DIR = join(PROJECT_ROOT, 'data', 'videos');
/** The fewest frames laid out for a lane to look at, whatever the length. */
export const FRAME_COUNT = 8;
/** The most: past this a lane is buried in pictures rather than watching. */
export const MAX_FRAMES = 30;
/** One look every this many seconds, between those two. */
const SECONDS_PER_FRAME = 5;
/** The longest video the room takes unless videos.max_seconds says otherwise (theirs, Nov 11 2026: ten minutes). */
export const DEFAULT_MAX_SECONDS = 600;
/** The words go to the local speech-to-text in pieces this long; it is built for short stretches,
 *  and each piece becomes one timed line for the Screening Room's clock. */
const TRANSCRIBE_PIECE_SECONDS = 15;
const MAX_FILESIZE = '300M';

/**
 * How many frames a video of this length gets (theirs, Nov 11 2026: 'you boys
 * would get all the frames and words thrown at you, right?'). Eight frames was
 * nearly everything for a TikTok and a slideshow for anything long, so it is
 * one look every five seconds, never fewer than eight, never more than thirty.
 */
export function framesFor(durationS: number | null): number {
  if (!durationS || !Number.isFinite(durationS) || durationS <= 0) return FRAME_COUNT;
  return Math.max(FRAME_COUNT, Math.min(MAX_FRAMES, Math.round(durationS / SECONDS_PER_FRAME)));
}

/** The room's length limit in seconds, from videos.max_seconds, or ten minutes. */
export function maxSeconds(): number {
  const n = Number(getConfig('videos.max_seconds'));
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_SECONDS;
}

/** The plain line for a video past the limit, or null when it fits. */
export function tooLong(durationS: number | null, limit = maxSeconds()): string | null {
  if (!durationS || !Number.isFinite(durationS) || durationS <= limit) return null;
  const mins = (s: number) => (s >= 120 ? `${Math.round(s / 60)} minutes` : `${Math.round(s)} seconds`);
  // Read after 'That one would not come through:', so no capital and no full stop.
  return `it runs ${mins(durationS)} and the Video Room takes up to ${mins(limit)}`;
}

export type VideoStatus = 'fetching' | 'ready' | 'failed';

export interface Video {
  id: string;
  url: string;
  note: string | null;
  title: string | null;
  uploader: string | null;
  durationS: number | null;
  status: VideoStatus;
  error: string | null;
  transcript: string | null;
  createdAt: string;
}

interface Row {
  id: string; url: string; note: string | null; title: string | null; uploader: string | null;
  duration_s: number | null; status: VideoStatus; error: string | null; transcript: string | null; created_at: string;
}

export function ensureVideosTable(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS videos (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      note TEXT,
      title TEXT,
      uploader TEXT,
      duration_s REAL,
      status TEXT NOT NULL,
      error TEXT,
      transcript TEXT,
      created_at TEXT NOT NULL
    )
  `);
}

const fromRow = (r: Row): Video => ({
  id: r.id, url: r.url, note: r.note, title: r.title, uploader: r.uploader, durationS: r.duration_s,
  status: r.status, error: r.error, transcript: r.transcript, createdAt: r.created_at,
});

export function listVideos(limit = 60): Video[] {
  ensureVideosTable();
  return (getDb().prepare('SELECT * FROM videos ORDER BY created_at DESC LIMIT ?').all(limit) as Row[]).map(fromRow);
}

export function getVideo(id: string): Video | null {
  ensureVideosTable();
  const row = getDb().prepare('SELECT * FROM videos WHERE id = ?').get(id) as Row | undefined;
  return row ? fromRow(row) : null;
}

/** Only web links; yt-dlp is told about nothing else. */
export function videoUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function addVideo(url: string, note: string | null): Video {
  ensureVideosTable();
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  getDb().prepare('INSERT INTO videos (id, url, note, status, created_at) VALUES (?, ?, ?, ?, ?)').run(id, url, note, 'fetching', createdAt);
  return getVideo(id)!;
}

function update(id: string, fields: Partial<Omit<Row, 'id'>>): void {
  const keys = Object.keys(fields) as Array<keyof typeof fields>;
  if (!keys.length) return;
  getDb().prepare(`UPDATE videos SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => fields[k] ?? null), id);
}

export function videoDir(id: string): string {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Not a video id');
  return join(VIDEOS_DIR, id);
}

/** The playable file, or null. */
export function videoFile(id: string): string | null {
  const dir = videoDir(id);
  const path = join(dir, 'video.mp4');
  return existsSync(path) ? path : null;
}

/** The frames, in order, as absolute paths a lane can read. */
export function framePaths(id: string): string[] {
  const dir = videoDir(id);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /^f\d+\.jpg$/.test(f))
    .sort((a, b) => Number(a.slice(1, -4)) - Number(b.slice(1, -4)))
    .map((f) => join(dir, f));
}

function ytdlpPath(): string {
  return getConfig('videos.ytdlp_path') || join(homedir(), 'tools', 'video-venv', 'bin', 'yt-dlp');
}

/** Fetch, frame and transcribe. Never throws: a failure is written on the row. */
export async function fetchVideo(id: string): Promise<Video | null> {
  const video = getVideo(id);
  if (!video) return null;
  const dir = videoDir(id);
  mkdirSync(dir, { recursive: true });
  try {
    const ytdlp = ytdlpPath();
    if (!existsSync(ytdlp)) throw new Error(`yt-dlp is not installed where the house looks (${ytdlp}); set videos.ytdlp_path`);
    // Ask how long it is before anything downloads; a link that will not say
    // is fetched and measured after instead.
    let announced: number | null = null;
    try {
      const { stdout } = await run(ytdlp, ['--no-warnings', '--impersonate', 'chrome', '--no-playlist', '--skip-download', '--print', 'duration', video.url], { timeout: 90_000 });
      const n = Number.parseFloat(stdout.trim().split('\n').pop() ?? '');
      if (Number.isFinite(n) && n > 0) announced = n;
    } catch {
      announced = null;
    }
    const early = tooLong(announced);
    if (early) {
      update(id, { duration_s: announced, status: 'failed', error: early });
      return getVideo(id);
    }
    await run(ytdlp, [
      '--no-warnings', '--impersonate', 'chrome', '--no-playlist', '--write-info-json',
      '--max-filesize', MAX_FILESIZE, '-S', 'res:720,ext:mp4:m4a',
      '-o', join(dir, 'source.%(ext)s'), video.url,
    ], { timeout: 5 * 60_000, maxBuffer: 8 * 1024 * 1024 });
    const source = readdirSync(dir).find((f) => f.startsWith('source.') && !f.endsWith('.info.json') && !f.endsWith('.json'));
    if (!source) throw new Error('The link gave no video');
    const info = readInfo(dir);
    update(id, {
      title: typeof info.title === 'string' ? info.title.slice(0, 200) : null,
      uploader: typeof info.uploader === 'string' ? info.uploader.slice(0, 120) : (typeof info.channel === 'string' ? info.channel.slice(0, 120) : null),
    });
    const src = join(dir, source);
    // One file the phone's player always takes: H.264 and AAC in an mp4.
    await run('ffmpeg', ['-v', 'error', '-y', '-i', src, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26',
      '-vf', 'scale=trunc(min(iw\\,1280)/2)*2:-2', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', join(dir, 'video.mp4')],
      { timeout: 10 * 60_000 });
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(dir, 'video.mp4')]);
    const duration = Number.parseFloat(stdout.trim());
    if (Number.isFinite(duration)) update(id, { duration_s: duration });
    const late = tooLong(Number.isFinite(duration) ? duration : null);
    if (late) throw new Error(late);
    const frames = framesFor(Number.isFinite(duration) ? duration : null);
    for (let i = 0; i < frames; i++) {
      const t = (Number.isFinite(duration) ? duration : 10) * (i + 0.5) / frames;
      await run('ffmpeg', ['-v', 'error', '-y', '-ss', String(t), '-i', join(dir, 'video.mp4'), '-frames:v', '1', '-vf', 'scale=640:-2', join(dir, `f${i}.jpg`)]);
    }
    const cues = await transcribe(dir, Number.isFinite(duration) ? duration : null);
    writeFileSync(join(dir, 'cues.json'), JSON.stringify(cues));
    const words = cues.map((c) => c.text).join(' ').trim();
    update(id, { transcript: words ? words.slice(0, 20_000) : null, status: 'ready', error: null });
    // Only the playable copy, the frames and the info stay; the rest was working space.
    for (const f of readdirSync(dir)) {
      if ((f.startsWith('source.') && !f.endsWith('.json')) || /^audio(-\d+)?\.wav$/.test(f)) rmSync(join(dir, f), { force: true });
    }
  } catch (error) {
    update(id, { status: 'failed', error: plainError(error) });
  }
  return getVideo(id);
}

/**
 * The one line worth showing from a failed fetch: yt-dlp's own ERROR line when
 * there is one (YouTube's sign-in check reads plainly that way), never the
 * command line that failed.
 */
export function plainError(error: unknown): string {
  const stderr = typeof (error as { stderr?: unknown })?.stderr === 'string' ? (error as { stderr: string }).stderr : '';
  const said = stderr.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('ERROR:')).pop();
  if (said) {
    const text = said.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?([\w-]+:\s*)?/, '');
    if (/sign in to confirm/i.test(text)) return 'YouTube wants a signed-in browser before it lets this box fetch videos (it does that to servers). TikTok and most others work as they are.';
    return text.slice(0, 300);
  }
  const message = error instanceof Error ? error.message : String(error);
  return message.split('\n').find((l) => l.trim() && !l.startsWith('Command failed'))?.slice(0, 300) ?? 'The fetch failed';
}

function readInfo(dir: string): Record<string, unknown> {
  const file = readdirSync(dir).find((f) => f.endsWith('.info.json'));
  if (!file) return {};
  try { return JSON.parse(readFileSync(join(dir, file), 'utf-8')) as Record<string, unknown>; } catch { return {}; }
}

/**
 * Every word said in it, through the local speech-to-text, fifteen seconds at a
 * time (it is built for short stretches), each piece one timed line. A line is
 * stamped at the END of its piece, so the Screening Room's clock only hands it
 * over once the whole piece has played: the spoiler guard holds for a video
 * the same way it holds for a show. Empty when there is no server or it hears
 * nothing; the room's length limit is what keeps this bounded.
 */
async function transcribe(dir: string, durationS: number | null): Promise<Cue[]> {
  const url = getConfig('voice.local_stt_url');
  if (!url) return [];
  const total = durationS && Number.isFinite(durationS) ? Math.min(durationS, maxSeconds()) : TRANSCRIBE_PIECE_SECONDS;
  const cues: Cue[] = [];
  for (let start = 0, i = 0; start < total; start += TRANSCRIBE_PIECE_SECONDS, i++) {
    const wav = join(dir, `audio-${i}.wav`);
    try {
      await run('ffmpeg', ['-v', 'error', '-y', '-ss', String(start), '-t', String(TRANSCRIBE_PIECE_SECONDS), '-i', join(dir, 'video.mp4'), '-vn', '-ac', '1', '-ar', '16000', wav], { timeout: 120_000 });
      if (!existsSync(wav) || statSync(wav).size < 2000) continue;
      const text = (await transcribeWithLocalServer(url, readFileSync(wav), 'audio/wav', { timeoutMs: 120_000 })).trim();
      const end = Math.round(Math.min(total, start + TRANSCRIBE_PIECE_SECONDS) * 1000);
      if (text) cues.push({ index: cues.length + 1, startMs: end, endMs: end, text });
    } catch {
      // One piece the server could not hear is a gap, not the end of the words.
    } finally {
      rmSync(wav, { force: true });
    }
  }
  return cues;
}

/** A kept video's timed words, as the Screening Room reads them; [] when there are none. */
export function videoCues(id: string): Cue[] {
  try {
    const parsed = JSON.parse(readFileSync(join(videoDir(id), 'cues.json'), 'utf-8'));
    return Array.isArray(parsed) ? parsed as Cue[] : [];
  } catch {
    return [];
  }
}

/**
 * The frames already played by a clock at `ms`, with the second each sits at,
 * newest last. Frame i of n sits at duration x (i + 0.5) / n, which is where
 * fetchVideo cut it. Nothing past the clock comes back.
 */
export function framesUpTo(video: Video, ms: number): Array<{ path: string; atMs: number }> {
  const paths = framePaths(video.id);
  const d = video.durationS && Number.isFinite(video.durationS) ? video.durationS : 10;
  return paths
    .map((path, i) => ({ path, atMs: Math.round((d * (i + 0.5) / paths.length) * 1000) }))
    .filter((f) => f.atMs <= ms);
}

/**
 * What a companion turn is told about a video being played in the Videos tab,
 * up to where their player is and no further: the frames already played and the
 * words already said. Same guard as the Screening Room, in this file.
 */
export function describeVideoAt(video: Video, ms: number): string {
  const at = Math.max(0, Math.round(ms));
  const clock = (t: number) => `${Math.floor(t / 60000)}:${String(Math.floor((t % 60000) / 1000)).padStart(2, '0')}`;
  const lines = [
    `"${video.title || 'Untitled'}"${video.uploader ? ` by ${video.uploader}` : ''}${video.durationS ? `, ${Math.round(video.durationS)} seconds long` : ''}. ${video.url}`,
    `Their player is at ${clock(at)}. Nothing past that point is handed to you, and you never guess ahead.`,
  ];
  const frames = framesUpTo(video, at).slice(-10);
  if (frames.length) lines.push(`Frames so far, in order (Read each one):\n${frames.map((f) => `${clock(f.atMs)}  ${f.path}`).join('\n')}`);
  const said = videoCues(video.id).filter((c) => c.startMs <= at).map((c) => c.text);
  lines.push(said.length ? `What has been said so far:\n${said.join(' ').slice(-6000)}` : 'Nothing said yet, as far as the words go.');
  return lines.join('\n');
}

/** What a companion turn is told about one video. */
export function describeVideo(video: Video): string {
  const lines = [
    `"${video.title || 'Untitled'}"${video.uploader ? ` by ${video.uploader}` : ''}${video.durationS ? `, ${Math.round(video.durationS)} seconds` : ''}. ${video.url}`,
  ];
  const frames = framePaths(video.id);
  if (frames.length) lines.push(`Frames from start to end, in order (Read each one to watch it):\n${frames.join('\n')}`);
  lines.push(video.transcript ? `What is said in it:\n${video.transcript}` : 'No words were heard in it (music only, or the speech could not be read).');
  return lines.join('\n');
}
