// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The five reactions at the top of the React tray. The owner picks them in
// Settings, Look & feel (the owner's ask, Oct 26 2026); a slot the owner never set keeps the
// house's own choice for that place.

export const DEFAULT_QUICK_REACTIONS = ['❤️', '👍', '🔥', '😂', '😮'];
export const QUICK_REACTION_COUNT = DEFAULT_QUICK_REACTIONS.length;

/** The owner's five, in order, with any empty or unreadable slot filled from the defaults. */
export function quickReactionsOf(saved: unknown): string[] {
  const list = Array.isArray(saved) ? saved : [];
  return DEFAULT_QUICK_REACTIONS.map((fallback, i) => {
    const pick = list[i];
    return typeof pick === 'string' && pick.trim() ? pick.trim() : fallback;
  });
}
