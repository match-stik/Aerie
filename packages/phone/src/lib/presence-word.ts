// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The one dot under the faces at the top of a conversation, and the word
// beside it (Oct 20 2026).
//
// The word follows the bell: while a bell that carries a status word is
// running (the backend's services/bell-status.ts, a setting on the bell), that
// word shows, here and on the contact cards of the companions it belongs to;
// otherwise it says Home. The house's own words are data, so nothing here
// names one but Home.

/** The word when no bell's word is up. */
export const HOME_WORD = 'Home';

export interface StatusWordState {
  word: string | null;
  /** Whose cards show it; empty for every companion's. */
  companions: string[];
}

/** The word beside the dot under the faces. */
export function headerWord(status: StatusWordState): string {
  return status.word?.trim() || HOME_WORD;
}

/** What a companion's contact card says: the bell's word while it is up for them, else their own. */
export function cardStatus(slug: string, own: string, status: StatusWordState): string {
  const word = status.word?.trim();
  if (!word) return own;
  return status.companions.length === 0 || status.companions.includes(slug) ? word : own;
}
