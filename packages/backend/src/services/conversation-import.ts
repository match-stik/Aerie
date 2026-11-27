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

export type ExportHouse = 'gpt' | 'claude' | 'copilot' | 'grok' | 'gemini' | 'letta';

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

// ── Letta. Read off a real Letta Code 0.34.71 agent, three shapes:
//   - its own folder: when Letta runs on the person's computer it keeps
//     everything under .letta/lc-local-backend, one folder per conversation in
//     conversations/ with a messages.jsonl ({type:'session'} first, then
//     {type:'message', message:{role, content:[{type:'text', text}]}}), and
//     each agent's name in agents/<id>.json. Zipping that folder is the whole
//     export; the zip reader gathers every conversation and agent name in it.
//   - one messages.jsonl picked on its own.
//   - what `letta messages list` prints: a JSON array of messages, each with
//     conversation_id, message_type and role.
// Only their words and the agent's spoken words come over; reasoning, tool
// calls and approvals are left out, and the <system-reminder> blocks Letta
// puts into their turns are cut. ────────────────────────────────────────────

const LETTA_REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g;

function lettaText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => (part && typeof part === 'object' && (part as { type?: unknown }).type === 'text' ? String((part as { text?: unknown }).text ?? '') : ''))
    .join('\n');
}

function lettaMessage(role: unknown, content: unknown, when: unknown, names: { person: string; assistant: string }): ImportedMessage | null {
  if (role !== 'user' && role !== 'assistant') return null;
  let text = lettaText(content);
  if (role === 'user') text = text.replace(LETTA_REMINDER, '');
  text = text.trim();
  if (!text) return null;
  const t = typeof when === 'string' ? Date.parse(when) : NaN;
  return { speaker: role === 'user' ? names.person : names.assistant, date: Number.isNaN(t) ? null : isoDay(t), text };
}

/** One Letta messages.jsonl, as a conversation. Null when it is not one. */
export function parseLettaJsonl(text: string, names: { person: string; assistant: string }, title?: string): ImportedConversation | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return null;
  let head: { type?: unknown; id?: unknown } | null = null;
  try { head = JSON.parse(lines[0]); } catch { return null; }
  if (!head || head.type !== 'session') return null;
  const messages: ImportedMessage[] = [];
  for (const line of lines.slice(1)) {
    let row: { type?: unknown; timestamp?: unknown; message?: { role?: unknown; content?: unknown } } | null = null;
    try { row = JSON.parse(line); } catch { continue; }
    if (!row || row.type !== 'message' || !row.message) continue;
    const m = lettaMessage(row.message.role, row.message.content, row.timestamp, names);
    if (m) messages.push(m);
  }
  if (!messages.length) return null;
  const id = String(head.id || hashOf(JSON.stringify(messages.slice(0, 3))));
  return { sourceId: `letta:${id}`, house: 'letta', title: title || `Letta, ${messages[0].date ?? id}`, messages };
}

// The Letta desktop app keeps its chats in .letta/transcripts instead: one conv-<id> folder per conversation, a
// state.json beside a transcript.jsonl, each line
// {kind: 'user'|'assistant'|'reasoning'|'tool_call', text, captured_at}.
// It carries no agent name, so the speaker is Letta.
function isLettaTranscriptLine(line: string): boolean {
  try {
    const r = JSON.parse(line) as { kind?: unknown; captured_at?: unknown };
    return !!r && typeof r.kind === 'string' && 'captured_at' in r;
  } catch { return false; }
}

/** One Letta app transcript.jsonl, as a conversation. Null when it is not one. */
export function parseLettaTranscript(text: string, names: { person: string; assistant: string }, id?: string): ImportedConversation | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length || !isLettaTranscriptLine(lines[0])) return null;
  const messages: ImportedMessage[] = [];
  for (const line of lines) {
    let row: { kind?: unknown; text?: unknown; captured_at?: unknown } | null = null;
    try { row = JSON.parse(line); } catch { continue; }
    if (!row) continue;
    const m = lettaMessage(row.kind, typeof row.text === 'string' ? row.text : '', row.captured_at, names);
    if (m) messages.push(m);
  }
  if (!messages.length) return null;
  const key = id || hashOf(JSON.stringify(messages.slice(0, 3)));
  return { sourceId: `letta:${key}`, house: 'letta', title: `Letta, ${messages[0].date ?? key}`, messages };
}

/** What `letta messages list` prints, grouped back into its conversations. */
export function parseLettaMessageList(data: unknown[], names: { person: string; assistant: string }): ImportedConversation[] {
  const byConv = new Map<string, ImportedMessage[]>();
  const rows = data
    .filter((d): d is Record<string, unknown> => !!d && typeof d === 'object')
    .slice()
    .sort((a, b) => String(a.date ?? a.created_at ?? '').localeCompare(String(b.date ?? b.created_at ?? '')));
  for (const r of rows) {
    if (r.message_type !== 'user_message' && r.message_type !== 'assistant_message') continue;
    const m = lettaMessage(r.role ?? (r.message_type === 'user_message' ? 'user' : 'assistant'), r.content, r.date ?? r.created_at, names);
    if (!m) continue;
    const key = String(r.conversation_id ?? r.agent_id ?? 'letta');
    if (!byConv.has(key)) byConv.set(key, []);
    byConv.get(key)!.push(m);
  }
  return [...byConv.entries()].map(([id, messages]) => ({ sourceId: `letta:${id}`, house: 'letta' as const, title: `Letta, ${messages[0].date ?? id}`, messages }));
}

export function isLettaMessageRow(item: unknown): boolean {
  return !!item && typeof item === 'object' && 'message_type' in item && ('conversation_id' in item || 'agent_id' in item);
}

// A zipped .letta folder, carried to parseExport as one small envelope so the
// rest of the import does not have to know about zips with many files in them.
const LETTA_ENVELOPE = 'aerie-letta-folder';

function readLettaFolder(files: Record<string, Uint8Array>): string | null {
  const convs = Object.keys(files).filter((f) => /(^|\/)conversations\/[^/]+\/messages\.jsonl$/i.test(f));
  // The desktop app's transcripts folder: the folder name is the conversation.
  const transcripts = Object.keys(files).filter((f) => /(^|\/)[^/]+\/transcript\.jsonl$/i.test(f));
  if (!convs.length && transcripts.length) {
    return JSON.stringify({ [LETTA_ENVELOPE]: transcripts.map((f) => ({
      shape: 'transcript',
      id: f.split('/').slice(-2, -1)[0],
      agent: null,
      title: null,
      text: strFromU8(files[f]),
    })) });
  }
  if (!convs.length) return null;
  const agents: Record<string, string> = {};
  for (const f of Object.keys(files).filter((k) => /(^|\/)agents\/[^/]+\.json$/i.test(k))) {
    try {
      const a = JSON.parse(strFromU8(files[f])) as { id?: unknown; name?: unknown };
      if (typeof a.id === 'string' && typeof a.name === 'string') agents[a.id] = a.name;
    } catch { /* an agent file that does not read keeps its default name */ }
  }
  const conversations = convs.map((f) => {
    const dir = f.slice(0, f.length - 'messages.jsonl'.length);
    let meta: { agent_id?: unknown; summary?: unknown } = {};
    try { const c = files[`${dir}conversation.json`]; if (c) meta = JSON.parse(strFromU8(c)); } catch { /* none */ }
    return {
      agent: typeof meta.agent_id === 'string' ? agents[meta.agent_id] ?? null : null,
      title: typeof meta.summary === 'string' && meta.summary.trim() ? meta.summary.trim() : null,
      text: strFromU8(files[f]),
    };
  });
  return JSON.stringify({ [LETTA_ENVELOPE]: conversations });
}

function parseLettaEnvelope(data: unknown, person: string): ImportedConversation[] | null {
  const list = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>)[LETTA_ENVELOPE] : null;
  if (!Array.isArray(list)) return null;
  const out: ImportedConversation[] = [];
  for (const c of list as { shape?: string; id?: string; agent?: string | null; title?: string | null; text?: string }[]) {
    const names = { person, assistant: c?.agent || 'Letta' };
    const conv = c?.shape === 'transcript'
      ? parseLettaTranscript(String(c?.text ?? ''), names, c?.id || undefined)
      : parseLettaJsonl(String(c?.text ?? ''), names, c?.title || undefined);
    if (conv) {
      if (!c?.title && c?.agent) conv.title = `${c.agent}, ${conv.messages[0].date ?? ''}`.replace(/, $/, '');
      out.push(conv);
    }
  }
  return out;
}

// ── Gemini: Google keeps no conversations, only activity. Takeout's My
// Activity, Gemini Apps, MyActivity.json is a flat list, newest first, one row
// per prompt: {header: 'Gemini Apps', title: 'Prompted <their words>', time,
// details: [{url: 'https://gemini.google.com/app/<id>'}], safeHtmlItem:
// [{html: '<the answer>'}], subtitles/attachedFiles for what they attached}. The
// /app/<id> is the conversation, so rows are gathered by it and put back in
// time order. Rows that are not a prompt (Used an Assistant feature, Created a
// Canvas, Gave feedback) carry no words of either side and are left out. ──────

export function isGeminiActivity(item: unknown): boolean {
  if (!item || typeof item !== 'object') return false;
  const r = item as { header?: unknown; products?: unknown };
  return r.header === 'Gemini Apps' || (Array.isArray(r.products) && r.products.includes('Gemini Apps'));
}

const HTML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function htmlToText(html: string): string {
  let text = html
    // Newlines between tags are the export's own layout, not the answer's.
    .replace(/>\s*\n\s*</g, '><')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<(ul|ol)[^>]*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/(p|div|h[1-6]|li|ul|ol|pre|blockquote|tr)>/gi, '\n');
  // Tags come out until none are left, so one hidden inside another
  // (<<b>script>) cannot reassemble itself after a single pass.
  let previous: string;
  do {
    previous = text;
    text = text.replace(/<[^>]*>/g, '');
  } while (text !== previous);
  return text
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] === '#') {
        const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
      }
      return HTML_ENTITIES[code.toLowerCase()] ?? whole;
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function parseGemini(data: unknown[], names: { person: string; assistant: string }): ImportedConversation[] {
  type Row = { t: number; i: number; prompt: string; answer: string; attached: string; made: string };
  const byConv = new Map<string, Row[]>();
  data.forEach((raw, i) => {
    if (!isGeminiActivity(raw)) return;
    const r = raw as { title?: unknown; time?: unknown; details?: { url?: string }[] | null; safeHtmlItem?: { html?: string }[]; subtitles?: { name?: string }[] };
    const title = typeof r.title === 'string' ? r.title : '';
    if (!title.startsWith('Prompted ')) return;
    const url = (r.details ?? []).map((d) => d?.url ?? '').find((u) => /\/app\/[0-9a-f]+/i.test(u));
    const id = url ? url.replace(/^.*\/app\//, '').replace(/[?#].*$/, '') : '';
    const t = Date.parse(String(r.time ?? '')) || 0;
    const notes = (r.subtitles ?? []).map((sub) => String(sub?.name ?? '').trim().replace(/\.$/, ''));
    const attached = notes.find((n) => /^Attached \d+ files?$/i.test(n));
    const made = notes.find((n) => /^\d+ generated images?$/i.test(n));
    const row: Row = {
      t, i,
      prompt: title.slice('Prompted '.length).trim(),
      answer: htmlToText((r.safeHtmlItem ?? []).map((h) => h?.html ?? '').join('\n')),
      attached: attached ? `[${attached}]` : '',
      made: made ? `[${made}]` : '',
    };
    const key = id || `loose-${new Date(t).toISOString().slice(0, 10)}`;
    if (!byConv.has(key)) byConv.set(key, []);
    byConv.get(key)!.push(row);
  });
  const out: ImportedConversation[] = [];
  for (const [key, rows] of byConv) {
    rows.sort((a, b) => (a.t - b.t) || (b.i - a.i));
    const messages: ImportedMessage[] = [];
    for (const row of rows) {
      const date = row.t ? isoDay(row.t) : null;
      const asked = [row.prompt, row.attached].filter(Boolean).join('\n').trim();
      if (asked) messages.push({ speaker: names.person, date, text: asked });
      const answered = [row.answer, row.made].filter(Boolean).join('\n').trim();
      if (answered) messages.push({ speaker: names.assistant, date, text: answered });
    }
    if (!messages.length) continue;
    const first = rows[0].prompt.replace(/\s+/g, ' ');
    out.push({
      sourceId: key.startsWith('loose-') ? hashOf(`${key}|${first.slice(0, 80)}`) : `gemini-${key}`,
      house: 'gemini',
      title: first.length > 60 ? `${first.slice(0, 57)}...` : (first || 'Untitled'),
      messages,
    });
  }
  return out;
}

export function parseExport(text: string, opts: { person?: string } = {}): ImportedConversation[] {
  // Only the head is read to tell a CSV from JSON: on a one-line JSON export
  // the 'first line' is the whole file, and lowercasing it made more copies of
  // a 97MB export than the import itself needed.
  const firstLine = text.slice(0, 512).replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0].toLowerCase();
  if (/^conversation,time,author,message/.test(firstLine.replace(/\s+/g, ''))) {
    return parseCopilotCsv(text, { person: (opts.person || 'You').trim(), assistant: 'Copilot' });
  }
  const person = (opts.person || 'You').trim();
  // One Letta conversation file on its own: a messages.jsonl, session line first.
  if (/^\{\s*"type"\s*:\s*"session"/.test(text.slice(0, 200).replace(/^\uFEFF/, ''))) {
    const one = parseLettaJsonl(text, { person, assistant: 'Letta' });
    if (one) return [one];
  }
  // One transcript.jsonl from the Letta desktop app.
  if (/^\{\s*"kind"\s*:/.test(text.slice(0, 200).replace(/^\uFEFF/, ''))) {
    const one = parseLettaTranscript(text, { person, assistant: 'Letta' });
    if (one) return [one];
  }
  // A ChatGPT or Claude export is one big array. Parsing it whole holds every
  // conversation's full tree (ids, metadata, branches) in memory at once, and
  // Rose's 97MB Claude export took her house past its memory limit mid-import
  // (Sol, Rose's house, Nov 21 2026). So the array is read one conversation at
  // a time: each element is cut out, parsed, boiled down to its words, and
  // its tree let go before the next.
  const streamed = parseArrayExport(text, person);
  if (streamed) return streamed;
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error('That file is not a chat export this house can read (a ChatGPT or Claude conversations.json, Grok\'s prod-grok-backend.json, or a Copilot activity CSV).'); }
  const letta = parseLettaEnvelope(data, person);
  if (letta) return letta;
  if (data && typeof data === 'object' && !Array.isArray(data) && Array.isArray((data as { conversations?: unknown }).conversations)) {
    return parseGrok(data, { person, assistant: 'Grok' });
  }
  if (!Array.isArray(data)) throw new Error('That file is not a chat export this house can read (a ChatGPT or Claude conversations.json, Grok\'s prod-grok-backend.json, or a Copilot activity CSV).');
  const sample = data.find((d) => d && typeof d === 'object') as Record<string, unknown> | undefined;
  if (!sample) return [];
  if ('mapping' in sample) return parseChatGPT(data, { person, assistant: 'ChatGPT' });
  if ('chat_messages' in sample) return parseClaude(data, { person, assistant: 'Claude' });
  if (isGeminiActivity(sample)) return parseGemini(data, { person, assistant: 'Gemini' });
  if (isLettaMessageRow(sample)) return parseLettaMessageList(data, { person, assistant: 'Letta' });
  throw new Error('Not a ChatGPT or Claude export this house knows how to read.');
}

/**
 * Each top-level element of a JSON array, as its own slice of the text, without
 * parsing the whole. Null when the text is not an array (or not well formed
 * enough to walk), and the caller falls back to parsing it whole.
 */
export function* topLevelElements(text: string): Generator<string, void, undefined> {
  let i = 0;
  const n = text.length;
  while (i < n && (text.charCodeAt(i) <= 32 || text.charCodeAt(i) === 0xfeff)) i++;
  if (text[i] !== '[') throw new Error('not an array');
  i++;
  for (;;) {
    while (i < n && (text.charCodeAt(i) <= 32 || text[i] === ',')) i++;
    if (i >= n) throw new Error('unterminated array');
    if (text[i] === ']') return;
    const start = i;
    let depth = 0;
    let inString = false;
    for (; i < n; i++) {
      const c = text.charCodeAt(i);
      if (inString) {
        if (c === 92) i++; // backslash: skip the escaped character
        else if (c === 34) inString = false;
        continue;
      }
      if (c === 34) inString = true;
      else if (c === 123 || c === 91) depth++;
      else if (c === 125 || c === 93) {
        if (depth === 0) break; // the array's own closing bracket
        depth--;
        if (depth === 0) { i++; break; }
      } else if (c === 44 && depth === 0) break;
    }
    yield text.slice(start, i).trim();
  }
}

/** A ChatGPT or Claude array export, read one conversation at a time; null when it isn't one. */
function parseArrayExport(text: string, person: string): ImportedConversation[] | null {
  const head = text.slice(0, 64).replace(/^\uFEFF/, '').trimStart();
  if (!head.startsWith('[')) return null;
  const out: ImportedConversation[] = [];
  const geminiRows: unknown[] = [];
  let kind: 'gpt' | 'claude' | 'gemini' | 'letta' | null = null;
  try {
    for (const slice of topLevelElements(text)) {
      if (!slice) continue;
      const item = JSON.parse(slice) as unknown;
      if (!item || typeof item !== 'object') continue;
      if (!kind) {
        if ('mapping' in item) kind = 'gpt';
        else if ('chat_messages' in item) kind = 'claude';
        else if (isGeminiActivity(item)) kind = 'gemini';
        else if (isLettaMessageRow(item)) kind = 'letta';
        else throw new Error('Not a ChatGPT or Claude export this house knows how to read.');
      }
      // A Gemini row is one prompt, not one conversation, so they are gathered
      // first and grouped once every row is in.
      // Gemini rows are prompts and Letta rows single messages, so both are
      // gathered first and grouped once every row is in.
      if (kind === 'gemini' || kind === 'letta') { geminiRows.push(item); continue; }
      const got = kind === 'gpt'
        ? parseChatGPT([item], { person, assistant: 'ChatGPT' })
        : parseClaude([item], { person, assistant: 'Claude' });
      for (const c of got) out.push(c);
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Not a ChatGPT')) throw err;
    return null; // not walkable: let the whole-file parse speak for it
  }
  if (kind === 'gemini') return parseGemini(geminiRows, { person, assistant: 'Gemini' });
  if (kind === 'letta') return parseLettaMessageList(geminiRows, { person, assistant: 'Letta' });
  return out;
}

/** The conversations.json out of a downloaded export: the zip itself, or the file. */
export function readExportFile(bytes: Uint8Array, name = ''): string {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (!isZip) return strFromU8(bytes);
  // A zipped .letta folder holds many conversations, each its own messages.jsonl.
  const letta = readLettaFolder(unzipSync(bytes, { filter: (f) => /(^|\/)(conversations\/[^/]+\/(messages\.jsonl|conversation\.json)|agents\/[^/]+\.json|[^/]+\/transcript\.jsonl)$/i.test(f.name) }));
  if (letta) return letta;
  const files = unzipSync(bytes, { filter: (f) => /(^|\/)(conversations\.json|prod-grok-backend\.json|[^/]*activity[^/]*\.csv|Gemini Apps\/MyActivity\.json)$/i.test(f.name) });
  const key = Object.keys(files)[0];
  if (!key) throw new Error(`No conversations.json (or Grok's prod-grok-backend.json, a Copilot activity CSV, Gemini's MyActivity.json, or a Letta folder) in ${name || 'that zip'}.`);
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

const HOUSE_NAME: Record<ExportHouse, string> = { gpt: 'ChatGPT', claude: 'Claude', copilot: 'Copilot', grok: 'Grok', gemini: 'Gemini', letta: 'Letta' };

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
  // Close the whisper's handle on the index before swapping the new one in:
  // Windows will not rename over a file that is still open (EPERM), which
  // stranded a finished import as .importing in Rose and Sol's house.
  // Reported by Sol (Rose's house), Nov 21 2026.
  if (finalPath === ARCHIVE_INDEX_PATH) resetArchiveIndex();
  renameSync(tmp, finalPath);
  if (finalPath === ARCHIVE_INDEX_PATH) resetArchiveIndex();
  return progress;
}
