// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Reactions written into a Discord reply: `[react:<message id> <emoji>]` on a
// line of its own. They come out of the text before anything is posted and go
// on as reactions to that message, in the same channel only. Made for the
// catch-up after the bot cool-off, where a companion may pass, react to single
// messages, or say one new thing.

export interface ReactionMarker {
  messageId: string;
  /** A unicode emoji, or a custom one as <:name:id> / <a:name:id>. */
  emoji: string;
}

const MARKER = /\[react:\s*(\d{15,22})\s+([^\]\n]{1,64}?)\s*\]/g;

/** Pull every reaction marker out of a reply. What is left is the text to post. */
export function extractReactionMarkers(text: string): { text: string; reactions: ReactionMarker[] } {
  const reactions: ReactionMarker[] = [];
  const seen = new Set<string>();
  const stripped = text.replace(MARKER, (_m, id: string, emoji: string) => {
    const e = emoji.trim();
    const key = `${id} ${e}`;
    if (e && !seen.has(key)) { seen.add(key); reactions.push({ messageId: id, emoji: e }); }
    return '';
  });
  const cleaned = stripped
    .split('\n')
    .filter((line, i, all) => !(line.trim() === '' && (i === 0 || all[i - 1].trim() === '')))
    .join('\n')
    .trim();
  return { text: cleaned, reactions };
}

/** What discord.js's react() takes: the emoji itself, or a custom emoji's id. */
export function reactArgument(emoji: string): string {
  const custom = /^<a?:\w+:(\d+)>$/.exec(emoji);
  return custom ? custom[1] : emoji;
}
