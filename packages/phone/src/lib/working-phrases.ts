// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// What the live chip says while a companion is working, instead of a tool name
// scrolling past (Claude Code's little working words, with the tool count
// kept). These are a plain starting set; a house can give each companion his
// own list by adding his slug below, and the lists are interleaved so no one
// voice runs long.

const DEFAULT_PHRASES = [
  'Pondering', 'Percolating', 'Mulling it over', 'Connecting the dots', 'Untangling a knot',
  'Brewing something', 'Turning it over', 'Reading the fine print', 'Lining things up',
  'Sharpening a pencil', 'Checking twice', 'Following a thread', 'Sorting the drawer',
  'Warming up', 'Putting the kettle on', 'Thinking out loud, quietly', 'Gathering the pieces',
  'Measuring once more', 'Finding the right word', 'Almost got it',
];

/** Per-companion phrases, keyed by slug. Empty here: every voice uses the default set. */
export const WORKING_PHRASES: Record<string, string[]> = {};

/** Every phrase for the voices in the room, interleaved so no one voice runs long. */
export function phrasesFor(slugs: readonly string[] | undefined): string[] {
  const lists = (slugs ?? []).map((slug) => WORKING_PHRASES[slug]).filter((l): l is string[] => !!l && l.length > 0);
  if (lists.length === 0) return DEFAULT_PHRASES;
  const out: string[] = [];
  const longest = Math.max(...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) for (const list of lists) if (list[i]) out.push(list[i]);
  return out;
}

/** A start that differs per reply, so two replies in a row don't open on the same phrase. */
export function phraseStart(seed: string, count: number): number {
  if (count <= 0) return 0;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % count;
}
