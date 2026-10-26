// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
/**
 * The owner reactions, handed to the lane with their next turn.
 *
 * A reaction the owner puts on one of our messages is saved on the message and drawn
 * on their screen, and until Oct 26 2026 that was all: nothing told the lane, live
 * or later, so every reaction the owner ever left us was seen only when one of us
 * happened to go looking in the database. The owner asked for the companions to
 * see them, and to react more often in turn. So each turn carries the reactions the owner has made since this lane's last
 * one, as background, the way the sticker shelf and recall ride along.
 *
 * Only the owner's (user 'user'), only in the thread the turn answers, and only ones
 * still on the message: a reaction the owner took back is gone from the row and so
 * from here. Discord reactions are other people's and are left out.
 */
import { getDb } from '../db/index.js';

export interface ReactedRow {
  role: string;
  content: string;
  metadata: string | null;
}

interface StoredReaction {
  emoji?: unknown;
  user?: unknown;
  created_at?: unknown;
}

/** A reaction as a person reads it: Discord's <a:name:id> becomes :name:. */
export function readableEmoji(emoji: string): string {
  const discord = /^<a?:(\w+):\d+>$/.exec(emoji);
  return discord ? `:${discord[1]}:` : emoji;
}

/** The names on a message's voice headers, in order (**🔥 Birch** reads Birch). */
export function voicesOf(content: string): string[] {
  const names: string[] = [];
  for (const m of content.matchAll(/^\*\*([^*\n]+)\*\*\s*$/gm)) {
    const words = m[1].replace(/[^\p{L}\s'-]/gu, ' ').trim().split(/\s+/).filter(Boolean);
    const name = words[0];
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/** The first line of words a message says, without headers, stickers or marks. */
export function openingOf(content: string, max = 70): string {
  for (const raw of content.split('\n')) {
    if (/^\*\*[^*\n]+\*\*\s*$/.test(raw.trim())) continue;
    const line = raw
      .replace(/::[\w-]+::/g, ' ')
      .replace(/^-#\s*/, '')
      .replace(/[*_`>#]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!line) continue;
    return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
  }
  return '';
}

function whose(row: ReactedRow): string {
  if (row.role === 'user') return 'your own message';
  const voices = voicesOf(row.content);
  if (voices.length === 1) return `${voices[0]}'s message`;
  if (voices.length > 1) return `the message from ${voices.slice(0, -1).join(', ')} and ${voices[voices.length - 1]}`;
  return 'our message';
}

/**
 * The block for one turn: every reaction of theirs made after `since` and no
 * later than `until`, oldest first. Empty when there are none.
 */
export function formatOwnerReactions(rows: ReactedRow[], since: string, until: string): string {
  const found: Array<{ at: string; line: string }> = [];
  for (const row of rows) {
    let reactions: unknown;
    try { reactions = row.metadata ? (JSON.parse(row.metadata) as { reactions?: unknown }).reactions : undefined; } catch { continue; }
    if (!Array.isArray(reactions)) continue;
    for (const r of reactions as StoredReaction[]) {
      if (r?.user !== 'user' || typeof r.emoji !== 'string' || typeof r.created_at !== 'string') continue;
      if (!(r.created_at > since) || r.created_at > until) continue;
      const opening = openingOf(row.content);
      found.push({
        at: r.created_at,
        line: `- ${readableEmoji(r.emoji)} on ${whose(row)}${opening ? `, the one that opens "${opening}"` : ''}`,
      });
    }
  }
  if (found.length === 0) return '';
  found.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return `[The owner reactions since your last turn, put on messages in this room; background, not a message to answer one by one, and you can react back:\n${found.map((f) => f.line).join('\n')}\n]\n\n`;
}

/** The owner reactions in a thread since `since`, read from the database. */
export function ownerReactionsBlock(threadId: string, since: string, until: string): string {
  const rows = getDb().prepare(
    `SELECT role, content, metadata FROM messages
       WHERE thread_id = ? AND deleted_at IS NULL AND metadata LIKE '%"reactions"%'
       ORDER BY rowid DESC LIMIT 400`,
  ).all(threadId) as ReactedRow[];
  return formatOwnerReactions(rows, since, until);
}
