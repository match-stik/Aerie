// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// services/conversation-import.ts — bring old chats back word for word.
//
// A ChatGPT or Claude data export (the conversations.json inside the zip each
// one emails you) is read straight from the download. Nothing reads it for
// meaning and no model is called: every conversation is cut into short passages
// exactly as written, each passage gets a fingerprint from the house's own small
// embedding model, and the passages join data/archive-index.db, the index the
// whisper searches so a line from an old window can surface mid-conversation in
// its own words. Each whole conversation also goes onto Cortex's conversation
// shelf when the house has Cortex, so the whisper's "whole window" pointer leads
// somewhere real.
//
// The index is only ever replaced whole: the import copies the current file,
// adds to the copy, and renames it into place, so the reader never opens half an
// index. A conversation already imported is skipped, so running the same export
// twice changes nothing.

import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, renameSync, unlinkSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { ARCHIVE_INDEX_PATH, resetArchiveIndex } from './archive-index.js';

export type ExportHouse = 'gpt' | 'claude' | 'copilot' | 'grok';

export interface ImportedMessage {
  speaker: string;
  /** YYYY-MM-DD, or null when the export did not say. */
  date: string | null;
  text: string;
}

export interface ImportedConversation {
  /** The export's own id for it, so a re-import can be recognised. */
  sourceId: string;
  house: ExportHouse;
  title: string;
  messages: ImportedMessage[];
}

export interface Passage {
  speaker: string;
  date: string | null;
  text: string;
}

const PASSAGE_TARGET = 950;
const PASSAGE_MIN = 60;

function isoDay(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
    const d = new Date(v < 1e12 ? v * 1000 : v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  if (typeof v === 'string' && v) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  return null;
}

// ── ChatGPT: a tree of messages; the conversation as shown is the branch that
// ends at current_node, walked back through parents. ────────────────────────

interface GptNode { parent?: string | null; message?: { author?: { role?: string }; content?: { content_type?: string; parts?: unknown[] }; create_time?: number | null } | null }

export function parseChatGPT(data: unknown[], names: { person: string; assistant: string }): ImportedConversation[] {
  const out: ImportedConversation[] = [];
  for (const raw of data) {
    const c = raw as { id?: string; conversation_id?: string; title?: string; create_time?: number; mapping?: Record<string, GptNode>; current_node?: string };
    if (!c || typeof c !== 'object' || !c.mapping) continue;
    const chain: GptNode[] = [];
    let at = c.current_node;
    const seen = new Set<string>();
    while (at && c.mapping[at] && !seen.has(at)) {
      seen.add(at);
      chain.push(c.mapping[at]);
      at = c.mapping[at].parent ?? undefined;
    }
    chain.reverse();
    const messages: ImportedMessage[] = [];
    for (const node of chain) {
      const m = node.message;
      const role = m?.author?.role;
      if (role !== 'user' && role !== 'assistant') continue;
      const parts = Array.isArray(m?.content?.parts) ? m!.content!.parts! : [];
      const text = parts.filter((p): p is string => typeof p === 'string').join('\n').trim();
      if (!text) continue;
      messages.push({ speaker: role === 'user' ? names.person : names.assistant, date: isoDay(m?.create_time) ?? isoDay(c.create_time), text });
    }
    if (!messages.length) continue;
    out.push({ sourceId: String(c.conversation_id || c.id || hashOf(JSON.stringify(messages.slice(0, 3)))), house: 'gpt', title: (c.title || 'Untitled').trim(), messages });
  }
  return out;
}

// ── Claude: a flat list per conversation. ──────────────────────────────────

export function parseClaude(data: unknown[], names: { person: string; assistant: string }): ImportedConversation[] {
  const out: ImportedConversation[] = [];
  for (const raw of data) {
    const c = raw as { uuid?: string; name?: string; created_at?: string; chat_messages?: { sender?: string; text?: string; content?: { type?: string; text?: string }[]; created_at?: string }[] };
    if (!c || typeof c !== 'object' || !Array.isArray(c.chat_messages)) continue;
    const messages: ImportedMessage[] = [];
    for (const m of c.chat_messages) {
      if (m.sender !== 'human' && m.sender !== 'assistant') continue;
      // Newer exports keep the words in content blocks (thinking and tool calls
      // sit beside them and are not anything anyone said); older ones in text.
      const blocks = Array.isArray(m.content) ? m.content.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text as string) : [];
      const text = (blocks.length ? blocks.join('\n') : (m.text || '')).trim();
      if (!text) continue;
      messages.push({ speaker: m.sender === 'human' ? names.person : names.assistant, date: isoDay(m.created_at) ?? isoDay(c.created_at), text });
    }
    if (!messages.length) continue;
    out.push({ sourceId: String(c.uuid || hashOf(JSON.stringify(messages.slice(0, 3)))), house: 'claude', title: (c.name || 'Untitled').trim(), messages });
  }
  return out;
}

// ── Copilot: Microsoft's activity export is a CSV (Conversation, Time,
// Author, Message), newest first, the AI's line listed above the person's
// when both carry the same second. Reversed, it reads in order. ───────────

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function parseCopilotCsv(text: string, names: { person: string; assistant: string }): ImportedConversation[] {
  const rows = parseCsv(text.replace(/^\uFEFF/, ''));
  const head = (rows.shift() ?? []).map((h) => h.trim().toLowerCase());
  const at = (n: string) => head.indexOf(n);
  const [ci, ti, ai, mi] = [at('conversation'), at('time'), at('author'), at('message')];
  if ([ci, ti, ai, mi].some((i) => i < 0)) throw new Error('Not a Copilot activity export this house knows how to read.');
  const byTitle = new Map<string, ImportedMessage[]>();
  for (const r of rows.reverse()) {
    const title = (r[ci] || 'Untitled').trim();
    const textOf = (r[mi] || '').trim();
    if (!textOf) continue;
    const who = (r[ai] || '').trim().toLowerCase();
    const msg = { speaker: who === 'ai' || who === 'copilot' ? names.assistant : names.person, date: isoDay(r[ti]), text: textOf };
    if (!byTitle.has(title)) byTitle.set(title, []);
    byTitle.get(title)!.push(msg);
  }
  return [...byTitle.entries()].map(([title, messages]) => ({
    sourceId: hashOf(`${title}|${messages[0]?.date ?? ''}|${messages[0]?.text.slice(0, 80) ?? ''}`),
    house: 'copilot' as const, title, messages,
  }));
}

// ── Grok: xAI's data export holds prod-grok-backend.json (beside an account
// file this house never reads): {conversations: [{conversation: {title, ...},
// responses: [{response: {sender, message, create_time}}]}]}. Times come in
// MongoDB's extended form ({$date: {$numberLong}}) or plain; the order is
// the response list's own, steadied by the times when every one has one. ──

function grokTime(v: unknown): number | null {
  if (v && typeof v === 'object' && '$date' in (v as Record<string, unknown>)) {
    const d = (v as { $date: unknown }).$date;
    if (d && typeof d === 'object' && '$numberLong' in (d as Record<string, unknown>)) return Number((d as { $numberLong: unknown }).$numberLong) || null;
    return grokTime(d);
  }
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v < 1e12 ? v * 1000 : v;
  if (typeof v === 'string' && v) { const t = Date.parse(v); return Number.isNaN(t) ? null : t; }
  return null;
}

export function parseGrok(data: unknown, names: { person: string; assistant: string }): ImportedConversation[] {
  const list = (data as { conversations?: unknown }).conversations;
  if (!Array.isArray(list)) throw new Error('Not a Grok export this house knows how to read.');
  const out: ImportedConversation[] = [];
  for (const raw of list) {
    const item = raw as { conversation?: { id?: string; _id?: string; title?: string; create_time?: unknown }; responses?: { response?: { sender?: string; message?: string; create_time?: unknown } }[] };
    if (!item || typeof item !== 'object' || !Array.isArray(item.responses)) continue;
    const conv = item.conversation ?? {};
    const rows = item.responses
      .map((r, i) => ({ r: r?.response ?? (r as { sender?: string; message?: string; create_time?: unknown }), i }))
      .map(({ r, i }) => ({ i, t: grokTime(r?.create_time), who: String(r?.sender ?? '').toLowerCase(), text: String(r?.message ?? '').trim() }))
      .filter((m) => m.text);
    if (rows.every((m) => m.t !== null)) rows.sort((a, b) => (a.t! - b.t!) || (a.i - b.i));
    const startDay = isoDay(grokTime(conv.create_time));
    const messages: ImportedMessage[] = rows.map((m) => ({
      speaker: m.who === 'human' || m.who === 'user' ? names.person : names.assistant,
      date: m.t !== null ? isoDay(m.t) : startDay,
      text: m.text,
    }));
    if (!messages.length) continue;
    out.push({ sourceId: String(conv.id || conv._id || hashOf(JSON.stringify(messages.slice(0, 3)))), house: 'grok', title: (conv.title || 'Untitled').trim(), messages });
  }
  return out;
}

export function parseExport(text: string, opts: { person?: string } = {}): ImportedConversation[] {
  const firstLine = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0].toLowerCase();
  if (/^conversation,time,author,message/.test(firstLine.replace(/\s+/g, ''))) {
    return parseCopilotCsv(text, { person: (opts.person || 'You').trim(), assistant: 'Copilot' });
  }
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error('That file is not a chat export this house can read (a ChatGPT or Claude conversations.json, Grok\'s prod-grok-backend.json, or a Copilot activity CSV).'); }
  const person = (opts.person || 'You').trim();
  if (data && typeof data === 'object' && !Array.isArray(data) && Array.isArray((data as { conversations?: unknown }).conversations)) {
    return parseGrok(data, { person, assistant: 'Grok' });
  }
  if (!Array.isArray(data)) throw new Error('That file is not a chat export this house can read (a ChatGPT or Claude conversations.json, Grok\'s prod-grok-backend.json, or a Copilot activity CSV).');
  const sample = data.find((d) => d && typeof d === 'object') as Record<string, unknown> | undefined;
  if (!sample) return [];
  if ('mapping' in sample) return parseChatGPT(data, { person, assistant: 'ChatGPT' });
  if ('chat_messages' in sample) return parseClaude(data, { person, assistant: 'Claude' });
  throw new Error('Not a ChatGPT or Claude export this house knows how to read.');
}

/** The conversations.json out of a downloaded export: the zip itself, or the file. */
export function readExportFile(bytes: Uint8Array, name = ''): string {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (!isZip) return strFromU8(bytes);
  const files = unzipSync(bytes, { filter: (f) => /(^|\/)(conversations\.json|prod-grok-backend\.json|[^/]*activity[^/]*\.csv)$/i.test(f.name) });
  const key = Object.keys(files)[0];
  if (!key) throw new Error(`No conversations.json (or Grok's prod-grok-backend.json, or a Copilot activity CSV) in ${name || 'that zip'}.`);
  return strFromU8(files[key]);
}

function hashOf(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 24);
}

const FENCE = /```[\s\S]*?```/g;
const IMAGE = /!\[[^\]]*\]\([^)]*\)/g;

// One message, cut where a reader would pause: paragraphs first, then
// sentences, then hard at the target if a single sentence runs on. Code blocks
// and image links are not anything anybody said aloud.
export function passagesFor(conv: ImportedConversation): Passage[] {
  const out: Passage[] = [];
  for (const m of conv.messages) {
    const body = m.text.replace(FENCE, ' [code] ').replace(IMAGE, ' ').replace(/[ \t]+/g, ' ').trim();
    if (body.length < PASSAGE_MIN) {
      if (body.length >= 20) out.push({ speaker: m.speaker, date: m.date, text: body });
      continue;
    }
    let cur = '';
    const push = () => { const t = cur.trim(); if (t.length >= 20) out.push({ speaker: m.speaker, date: m.date, text: t }); cur = ''; };
    for (const para of body.split(/\n\s*\n/)) {
      const pieces = para.length > PASSAGE_TARGET ? para.split(/(?<=[.!?])\s+/) : [para];
      for (let piece of pieces) {
        while (piece.length > PASSAGE_TARGET * 1.5) {
          if (cur) push();
          cur = piece.slice(0, PASSAGE_TARGET);
          push();
          piece = piece.slice(PASSAGE_TARGET);
        }
        if (cur && cur.length + piece.length + 1 > PASSAGE_TARGET) push();
        cur = cur ? `${cur}\n${piece}` : piece;
      }
      if (cur.length >= PASSAGE_TARGET * 0.6) push();
    }
    push();
  }
  return out;
}

export function conversationMarkdown(conv: ImportedConversation): string {
  return conv.messages.map((m) => `### ${m.speaker} — ${m.date ?? 'undated'}\n${m.text}`).join('\n\n');
}

const HOUSE_NAME: Record<ExportHouse, string> = { gpt: 'ChatGPT', claude: 'Claude', copilot: 'Copilot', grok: 'Grok' };

export interface ImportDeps {
  embed: (text: string) => Promise<Float32Array>;
  vectorToBuffer: (v: Float32Array) => Buffer;
  /** Puts the whole conversation on Cortex's shelf; returns its Cortex id, or null. */
  shelve?: (title: string, content: string, summary: string) => Promise<string | null>;
  indexPath?: string;
  onProgress?: (p: ImportProgress) => void;
}

export interface ImportProgress {
  conversations: number;
  done: number;
  skipped: number;
  passages: number;
  shelved: number;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS passages (
    id INTEGER PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    house TEXT NOT NULL,
    title TEXT,
    date TEXT,
    speaker TEXT,
    text TEXT NOT NULL,
    embedding BLOB NOT NULL
  );
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS imported (
    source_key TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    title TEXT,
    passages INTEGER NOT NULL,
    imported_at TEXT NOT NULL
  );
`;

export async function importConversations(convs: ImportedConversation[], deps: ImportDeps): Promise<ImportProgress> {
  const finalPath = deps.indexPath ?? ARCHIVE_INDEX_PATH;
  const tmp = `${finalPath}.importing`;
  if (existsSync(tmp)) unlinkSync(tmp);
  if (existsSync(finalPath)) copyFileSync(finalPath, tmp);
  const db = new Database(tmp);
  const progress: ImportProgress = { conversations: convs.length, done: 0, skipped: 0, passages: 0, shelved: 0 };
  try {
    db.exec(SCHEMA);
    const already = db.prepare('SELECT 1 FROM imported WHERE source_key = ?');
    const insert = db.prepare('INSERT INTO passages (conversation_id, house, title, date, speaker, text, embedding) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const mark = db.prepare('INSERT INTO imported (source_key, conversation_id, title, passages, imported_at) VALUES (?, ?, ?, ?, ?)');
    for (const conv of convs) {
      const key = `${conv.house}:${conv.sourceId}`;
      if (already.get(key)) { progress.skipped++; progress.done++; deps.onProgress?.({ ...progress }); continue; }
      const dates = conv.messages.map((m) => m.date).filter((d): d is string => Boolean(d)).sort();
      const first = dates[0] ?? 'undated';
      const last = dates[dates.length - 1] ?? first;
      let conversationId: string | null = null;
      if (deps.shelve) {
        try {
          conversationId = await deps.shelve(
            `OLD WINDOW — ${HOUSE_NAME[conv.house]} — ${first} — ${conv.title}`,
            conversationMarkdown(conv),
            `Imported from a ${HOUSE_NAME[conv.house]} export. ${first} to ${last}, ${conv.messages.length} messages.`,
          );
          if (conversationId) progress.shelved++;
        } catch { conversationId = null; }
      }
      const cid = conversationId ?? `export-${hashOf(key)}`;
      const rows: [string, string, string, string | null, string, string, Buffer][] = [];
      for (const p of passagesFor(conv)) {
        rows.push([cid, conv.house, conv.title, p.date, p.speaker, p.text, deps.vectorToBuffer(await deps.embed(p.text))]);
      }
      db.transaction(() => {
        for (const r of rows) insert.run(...r);
        mark.run(key, cid, conv.title, rows.length, new Date().toISOString());
      })();
      progress.passages += rows.length;
      progress.done++;
      deps.onProgress?.({ ...progress });
    }
    const total = (db.prepare('SELECT count(*) AS n FROM passages').get() as { n: number }).n;
    const meta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    meta.run('model', 'sentence-transformers/all-MiniLM-L6-v2');
    meta.run('built_at', new Date().toISOString());
    meta.run('passages', String(total));
    db.close();
  } catch (err) {
    try { db.close(); } catch { /* already closed */ }
    try { unlinkSync(tmp); } catch { /* nothing to clean */ }
    throw err;
  }
  renameSync(tmp, finalPath);
  if (finalPath === ARCHIVE_INDEX_PATH) resetArchiveIndex();
  return progress;
}
