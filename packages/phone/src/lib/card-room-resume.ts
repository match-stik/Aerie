// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Which game the Card Room reopens on. A house that has never dealt a hand
// has no table yet and the server answers { table: null }; reading .game off
// that threw, and the room showed 'Could not reach the table.' on every fresh
// house. No table means
// no game to pick back up, so the room opens on the bare table.

export type CardRoomTab = 'ratscrew' | 'golf' | 'eights' | 'president' | 'hearts' | 'spades' | 'euchre' | 'klondike';

export interface ResumableTable {
  game?: string | null;
  status?: string | null;
  updatedAt?: string | null;
}

// The table stores 'rat-screw'; the room's tab is 'ratscrew'. Mapped
// explicitly, so an unknown game name stays on the bare table.
const TABS: Record<string, CardRoomTab> = {
  'rat-screw': 'ratscrew',
  golf: 'golf',
  eights: 'eights',
  president: 'president',
  hearts: 'hearts',
  spades: 'spades',
  euchre: 'euchre',
  klondike: 'klondike',
};

// Only a game somebody touched lately is picked back up, so an old table left
// 'playing' from weeks ago doesn't drag anyone back into a finished game.
const RECENT_MS = 12 * 60 * 60 * 1000;

export function resumeTabFor(table: ResumableTable | null | undefined, now = Date.now()): CardRoomTab | null {
  if (!table) return null;
  const tab = table.game ? TABS[table.game] ?? null : null;
  if (!tab || table.status !== 'playing') return null;
  const touched = Date.parse(table.updatedAt ?? '');
  return Number.isFinite(touched) && now - touched < RECENT_MS ? tab : null;
}
