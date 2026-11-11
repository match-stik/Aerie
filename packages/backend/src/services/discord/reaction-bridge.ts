// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Reactions on Discord, carried home to the bubble they belong to, so a
// reaction somebody leaves on a companion's reply in a server shows on that
// bubble in the house. It covers every message that came in from Discord too.
//
// Two halves. When a reply goes out, the house row it was stored as learns the
// Discord message ids it became (a long reply is several Discord messages).
// When somebody reacts to one of those, the reaction lands on that row as
// 'discord:<their id>' with their name kept beside it, so nobody's reaction is
// mistaken for theirs or ours.

import { getDb } from '../db/state.js';
import { addReaction, removeReaction, type ReactionUser } from '../db/reactions.js';

/** How a Discord emoji is written into a reaction: the character itself for
 *  an ordinary emoji, and Discord's own <:name:id> (or <a:name:id> when it
 *  moves) for a server emote, which the phone draws off Discord's CDN. */
export function discordEmojiString(emoji: { id?: string | null; name?: string | null; animated?: boolean | null }): string | null {
  if (emoji.id) {
    const name = (emoji.name || 'emote').replace(/[^\w]/g, '_');
    return `<${emoji.animated ? 'a' : ''}:${name}:${emoji.id}>`;
  }
  return emoji.name || null;
}

/** How many of a thread's newest Discord replies are searched when a reply is
 *  sent. The one just sent is nearly always first; a few more covers a turn
 *  that also wrote chunks home. */
const RECENT_REPLIES = 25;

/** The house row a reply was stored as: our newest Discord reply in the thread
 *  whose words are exactly what was sent. Null when none matches, and then
 *  nothing is recorded rather than a guess. */
export function findReplyRow(threadId: string, sentText: string): string | null {
  const wanted = sentText.trim();
  if (!wanted) return null;
  const rows = getDb().prepare(`
    SELECT id, content FROM messages
    WHERE thread_id = ? AND role = 'companion' AND platform = 'discord' AND deleted_at IS NULL
    ORDER BY rowid DESC LIMIT ?
  `).all(threadId, RECENT_REPLIES) as Array<{ id: string; content: string }>;
  const row = rows.find((r) => (r.content ?? '').trim() === wanted);
  return row ? row.id : null;
}

/** Write down which Discord messages a stored reply became. Returns the row's
 *  id, or null when the row could not be found. */
export function recordSentDiscordIds(threadId: string, sentText: string, channelId: string, discordIds: string[]): string | null {
  if (discordIds.length === 0) return null;
  const rowId = findReplyRow(threadId, sentText);
  if (!rowId) return null;
  const row = getDb().prepare('SELECT metadata FROM messages WHERE id = ?').get(rowId) as { metadata: string | null } | undefined;
  let metadata: Record<string, unknown> = {};
  if (row?.metadata) {
    try { metadata = JSON.parse(row.metadata); } catch { metadata = {}; }
  }
  const known = Array.isArray(metadata.discordSentIds) ? (metadata.discordSentIds as unknown[]).filter((v): v is string => typeof v === 'string') : [];
  metadata.discordSentIds = [...new Set([...known, ...discordIds])];
  metadata.discordSentChannelId = channelId;
  getDb().prepare('UPDATE messages SET metadata = ? WHERE id = ?').run(JSON.stringify(metadata), rowId);
  return rowId;
}

/** The house row a Discord message lives on, or null: one of our replies (the
 *  ids it became when it was sent), or a message that came in from Discord,
 *  so reactions on those show at home too. An incoming row keeps every Discord
 *  id its batch was made of, so a reaction on any of them finds it; rows
 *  stored before that kept only the last one. */
export function findRowByDiscordId(discordMessageId: string): string | null {
  if (!/^\d+$/.test(discordMessageId)) return null;
  const rows = getDb().prepare(`
    SELECT id, metadata FROM messages
    WHERE platform = 'discord' AND deleted_at IS NULL AND metadata LIKE ?
    ORDER BY rowid DESC LIMIT 5
  `).all(`%"${discordMessageId}"%`) as Array<{ id: string; metadata: string | null }>;
  for (const row of rows) {
    try {
      const meta = JSON.parse(row.metadata ?? '{}') as { discordSentIds?: unknown; discordMessageIds?: unknown; discordMessageId?: unknown };
      if (Array.isArray(meta.discordSentIds) && meta.discordSentIds.includes(discordMessageId)) return row.id;
      if (Array.isArray(meta.discordMessageIds) && meta.discordMessageIds.includes(discordMessageId)) return row.id;
      if (meta.discordMessageId === discordMessageId) return row.id;
    } catch {
      // A row whose metadata will not parse is not one we wrote ids into.
    }
  }
  return null;
}

export type CarriedReaction = { messageId: string; emoji: string; user: ReactionUser; name: string };

/** Carry one Discord reaction home. Returns what changed, so the caller can
 *  tell the phone, or null when the message is not in the house or nothing
 *  changed (a repeat add, a remove of something never added). */
export function carryDiscordReaction(
  action: 'add' | 'remove',
  discordMessageId: string,
  emoji: string,
  reactor: { id: string; name: string },
): CarriedReaction | null {
  const messageId = findRowByDiscordId(discordMessageId);
  if (!messageId) return null;
  const user: ReactionUser = `discord:${reactor.id}`;
  const changed = action === 'add'
    ? addReaction(messageId, emoji, user, reactor.name)
    : removeReaction(messageId, emoji, user);
  return changed ? { messageId, emoji, user, name: reactor.name } : null;
}
