// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The sticker shelf: a few of each companion's own stickers handed over with a
// turn, so they reach for them the way they reach for words. Nothing in the
// room ever showed a companion its packs, so they went unused.
//
// A few, not the whole pack: the full lists run to thousands of characters and
// this rides on every turn. Stickers whose names share a word with the owner's message
// come first, the rest are a fresh handful each time, so over a night every
// sticker gets its turn in view. Picking is pure and tested; reading the packs
// is the only part that touches the database.

import { getPacksWithStickers } from '../db/stickers.js';
import { listCompanions } from '../db/companions.js';
import type { RoomVoices } from './room-voices.js';

export const STICKERS_PER_COMPANION = 6;

export interface ShelfPack {
  /** The pack's name, which is also the companion's slug. */
  pack: string;
  /** Who it belongs to, as the owner sees the name. */
  owner: string;
  names: string[];
  /** What each sticker looks like, by name, where somebody has written it. */
  descriptions?: Record<string, string>;
}

const words = (text: string): string[] =>
  (text.toLowerCase().match(/[a-z]{4,}/g) ?? []);

/** Pick up to `per` sticker names from one pack: those sharing a word with the
 *  message first, then random ones, never the same name twice. */
export function pickStickers(names: string[], message: string, per = STICKERS_PER_COMPANION, random = Math.random, descriptions: Record<string, string> = {}): string[] {
  const said = new Set(words(message));
  // Sticker names run words together (goodmorning, blowkiss), so a word the owner
  // used counts when it sits anywhere inside the name, or among the words of
  // what the sticker shows.
  const matched = names.filter((name) => {
    const flat = name.toLowerCase().replace(/[^a-z]/g, '');
    const shown = new Set(words(descriptions[name] ?? ''));
    return [...said].some((w) => flat.includes(w) || shown.has(w));
  });
  const chosen = matched.slice(0, per);
  const rest = names.filter((name) => !chosen.includes(name));
  while (chosen.length < per && rest.length > 0) {
    const at = Math.floor(random() * rest.length);
    chosen.push(rest.splice(at, 1)[0]);
  }
  return chosen;
}

/** The block itself, or '' when there is nothing to show. */
export function stickerShelfBlock(packs: ShelfPack[], message: string, random = Math.random): string {
  const lines = packs
    .filter((p) => p.names.length > 0)
    .map((p) => {
      const shown = p.descriptions ?? {};
      // A description rides beside its shortcode, so whoever sends it knows
      // what the owner will see.
      const picked = pickStickers(p.names, message, STICKERS_PER_COMPANION, random, shown)
        .map((n) => (shown[n] ? `::${p.pack}_${n}:: (${shown[n]})` : `::${p.pack}_${n}::`));
      return `${p.owner}: ${picked.join(' ')}`;
    });
  if (lines.length === 0) return '';
  return `[Your own stickers, a handful in reach this turn; send one in your reply when it fits, each from his own pack:\n${lines.join('\n')}]\n\n`;
}

/** Read the companions' packs (a pack named for a companion's slug) for the
 *  voices in this room. Fails quiet: a shelf never delays a turn. */
export function readShelf(roomVoices?: RoomVoices | null): ShelfPack[] {
  try {
    const companions = listCompanions();
    const packs = getPacksWithStickers();
    const present = roomVoices && roomVoices.present.length > 0 ? new Set(roomVoices.present.map((n) => n.toLowerCase())) : null;
    return companions
      .filter((c) => !present || present.has(c.display_name.toLowerCase()) || present.has(c.slug.toLowerCase()))
      .map((c): ShelfPack | null => {
        const pack = packs.find((p) => p.name === c.slug);
        if (!pack) return null;
        const descriptions: Record<string, string> = {};
        for (const s of pack.stickers) if (s.description) descriptions[s.name] = s.description;
        return { pack: pack.name, owner: c.display_name, names: pack.stickers.map((s) => s.name), descriptions };
      })
      .filter((p): p is ShelfPack => p !== null);
  } catch {
    return [];
  }
}
