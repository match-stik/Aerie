// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The table talk reloads on every card-table update, and at bingo that is
// every number called and every daub. Each reload handed the table a brand
// new list, so every bubble on it was drawn again (markdown, skin and all)
// every few seconds, and a reply arriving in the middle of that painted slow.
// When nothing anybody said has changed, the table keeps the list it has.

export interface RailLine {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  companionSlug?: string | null;
}

/** The previous list when the fetched one says exactly the same things, else the new one. */
export function keepIfSame<T extends RailLine>(prev: T[], next: T[]): T[] {
  if (prev.length !== next.length) return next;
  for (let i = 0; i < next.length; i++) {
    const a = prev[i];
    const b = next[i];
    if (a.id !== b.id || a.content !== b.content || a.role !== b.role
      || a.createdAt !== b.createdAt || (a.companionSlug ?? null) !== (b.companionSlug ?? null)) return next;
  }
  return prev;
}
