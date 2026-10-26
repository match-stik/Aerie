// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The reaction pill shows each reaction once with how many people used it,
// the way Discord does (the owner's ask, Oct 26 2026),
// in the order each one first arrived.

export interface ReactionGroup { emoji: string; count: number }

export function groupReactions(list: readonly string[]): ReactionGroup[] {
  const groups: ReactionGroup[] = [];
  const at = new Map<string, number>();
  for (const emoji of list) {
    const i = at.get(emoji);
    if (i === undefined) {
      at.set(emoji, groups.length);
      groups.push({ emoji, count: 1 });
    } else {
      groups[i].count += 1;
    }
  }
  return groups;
}
