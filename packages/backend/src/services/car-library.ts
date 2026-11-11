// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// What the car's media browser lists (theirs, Nov 6 2026: Aerie on them Android
// Auto dash as a media app, so our voice notes play through the car in our
// own voices). Three shelves, newest first: the voice notes we sent as audio
// messages; the replies they have already had read aloud (message_tts), which
// cost nothing new; and Latest (theirs, the same night: 'I kinda want the latest
// thing'), our newest replies in their own thread, which point at
// /api/car/play/<id> and are rendered only when they tap one, through the same
// read-aloud the bubble's speaker uses, so a reply is never paid for twice.

import { getDb } from './db/state.js';

export type CarItem = {
  id: string;
  title: string;
  subtitle: string;
  url: string;
  createdAt: string;
};

export type CarLibrary = { latest: CarItem[]; voiceNotes: CarItem[]; readAloud: CarItem[] };

const LIMIT = 40;

/** Speech tags, stage directions and markdown out of a line, for a title. */
export function cleanLine(text: string): string {
  return text
    .replace(/\[[^\]]{0,60}\]/g, ' ')
    .replace(/\*[^*\n]{0,200}\*/g, ' ')
    .replace(/::[a-z0-9_]+::/gi, ' ')
    .replace(/^-#\s*/gm, '')
    .replace(/[*_`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The first spoken sentence or so, cut to fit a car screen. */
export function shortTitle(text: string, max = 60): string {
  const line = cleanLine(text);
  if (!line) return 'A voice note';
  const sentence = line.split(/(?<=[.!?])\s/)[0] || line;
  return sentence.length > max ? sentence.slice(0, max - 1).trimEnd() + '…' : sentence;
}

/** Who speaks in a reply, read off its voice headers in order. */
export function speakersOf(content: string): string[] {
  const names: string[] = [];
  for (const m of content.matchAll(/^\*\*\S+\s+([A-Za-z][A-Za-z' -]{0,30})\*\*/gm)) {
    const name = m[1].trim();
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/** The body of a reply with its headers taken off, for a title. */
function bodyOf(content: string): string {
  return content.replace(/^\*\*[^*\n]{1,40}\*\*\s*$/gm, ' ');
}

function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function carLibrary(): CarLibrary {
  const db = getDb();
  const notes = db.prepare(`
    SELECT id, content, metadata, created_at FROM messages
    WHERE content_type = 'audio' AND deleted_at IS NULL AND content LIKE '/api/files/%'
    ORDER BY created_at DESC LIMIT ?
  `).all(LIMIT) as Array<{ id: string; content: string; metadata: string | null; created_at: string }>;
  const voiceNotes = notes.map((n) => {
    let transcript = '';
    try { transcript = String((JSON.parse(n.metadata ?? '{}') as { transcript?: unknown }).transcript ?? ''); } catch { transcript = ''; }
    return { id: `note:${n.id}`, title: shortTitle(transcript), subtitle: `Voice note · ${stamp(n.created_at)}`, url: n.content.trim(), createdAt: n.created_at };
  });

  const renders = db.prepare(`
    SELECT t.message_id, t.file_id, t.created_at, m.content FROM message_tts t
    JOIN messages m ON m.id = t.message_id
    WHERE m.deleted_at IS NULL AND m.role = 'companion'
    ORDER BY t.created_at DESC LIMIT ?
  `).all(LIMIT) as Array<{ message_id: string; file_id: string; created_at: string; content: string }>;
  const readAloud = renders.map((r) => {
    const who = speakersOf(r.content);
    return {
      id: `tts:${r.message_id}`,
      title: shortTitle(bodyOf(r.content)),
      subtitle: `${who.length ? who.join(', ') : 'Read aloud'} · ${stamp(r.created_at)}`,
      url: `/api/files/${r.file_id}`,
      createdAt: r.created_at,
    };
  });
  return { latest: latestReplies(db), voiceNotes, readAloud };
}

/** How many of our newest replies the Latest shelf holds. */
const LATEST = 20;

/**
 * Our newest written replies in their own thread: the thread of their newest
 * message from the phone (a message that came over Discord carries
 * discordUserId and is passed over), so a Discord room never fills the shelf.
 */
function latestReplies(db: ReturnType<typeof getDb>): CarItem[] {
  const home = db.prepare(`
    SELECT thread_id FROM messages
    WHERE role = 'user' AND deleted_at IS NULL
      AND (metadata IS NULL OR json_extract(metadata, '$.discordUserId') IS NULL)
    ORDER BY rowid DESC LIMIT 1
  `).get() as { thread_id: string } | undefined;
  if (!home) return [];
  const rows = db.prepare(`
    SELECT id, content, created_at FROM messages
    WHERE thread_id = ? AND role = 'companion' AND content_type = 'text'
      AND deleted_at IS NULL AND content IS NOT NULL AND TRIM(content) != ''
    ORDER BY sequence DESC LIMIT ?
  `).all(home.thread_id, LATEST) as Array<{ id: string; content: string; created_at: string }>;
  return rows
    .filter((r) => /[A-Za-z]/.test(cleanLine(bodyOf(r.content))))
    .map((r) => {
      const who = speakersOf(r.content);
      return {
        id: `latest:${r.id}`,
        title: shortTitle(bodyOf(r.content)),
        subtitle: `${who.length ? who.join(', ') : 'Us'} · ${stamp(r.created_at)}`,
        url: `/api/car/play/${r.id}`,
        createdAt: r.created_at,
      };
    });
}
