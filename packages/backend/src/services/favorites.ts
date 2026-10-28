// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
/**
 * Favorites: each contact card keeps its own small shelf of favorite pictures.
 *
 * Theirs, Oct 7 2026, said in a whisper while the owner worked: each card gets its own
 * gallery of favorites, picked by that card's owner (pairs, the four of us, the owner
 * with each of us), separate from the Studio gallery, which keeps everything
 * including the weird ones; the owner adds to them too. Built Oct 27 2026 on Birch's
 * ten o'clock, at their word.
 *
 * A favorite only POINTS at a picture that already lives in the house (a Studio
 * gallery file or an uploaded file); nothing is copied, moved or deleted, so
 * taking one off a shelf never touches the picture itself.
 *
 * Stored in config as `favorites.<card>`, one JSON array each, newest first,
 * where card is a companion slug or `owner` for their own card.
 */
import { randomUUID } from 'node:crypto';
import { getConfig, setConfig, listCompanions } from './db/index.js';

export const OWNER_CARD = 'owner';
/** Small on purpose: a shelf of favorites, not a second gallery. */
export const FAVORITES_MAX = 60;
export const FAVORITE_NOTE_MAX = 140;

export interface Favorite {
  id: string;
  /** A house address: /api/studio/gallery/<file> or /api/files/<id>. */
  url: string;
  /** Who put it on the shelf: a companion slug, or 'owner' when the owner did. */
  by: string;
  /** An optional line about it, in the words of whoever added it. */
  note: string | null;
  addedAt: string;
}

const keyFor = (card: string): string => `favorites.${card}`;

const GALLERY_URL = /^\/api\/studio\/gallery\/[A-Za-z0-9._-]+$/;
const FILE_URL = /^\/api\/files\/[A-Za-z0-9-]+(\.[A-Za-z0-9]+)?$/;

/**
 * The house address a favorite may point at, or null. A full https address on
 * one of the house's own fronts is trimmed to its path, so a link copied from
 * the phone works; anything outside the house is refused, because a shelf of
 * pointers into somebody else's server is not a shelf of ours.
 */
export function normalizeFavoriteUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let url = raw.trim();
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) {
    try {
      url = new URL(url).pathname;
    } catch {
      return null;
    }
  }
  url = url.split('?')[0].split('#')[0];
  try {
    url = decodeURIComponent(url);
  } catch {
    return null;
  }
  if (url.includes('..')) return null;
  if (GALLERY_URL.test(url) || FILE_URL.test(url)) return url;
  return null;
}

/** A card id the house knows: their own, or one of the companions'. */
export function isKnownCard(card: string): boolean {
  if (card === OWNER_CARD) return true;
  try {
    return listCompanions().some((c: { slug?: string; id?: string }) => (c.slug ?? c.id) === card);
  } catch {
    return false;
  }
}

export function readFavorites(card: string): Favorite[] {
  const raw = getConfig(keyFor(card));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((f): f is Favorite => !!f && typeof f.id === 'string' && typeof f.url === 'string')
      : [];
  } catch {
    return [];
  }
}

function writeFavorites(card: string, list: Favorite[]): void {
  setConfig(keyFor(card), JSON.stringify(list));
}

export type FavoriteResult =
  | { ok: true; favorites: Favorite[]; favorite?: Favorite }
  | { ok: false; error: string; status: number };

export function addFavorite(card: string, body: { url?: unknown; note?: unknown }, by: string): FavoriteResult {
  if (!isKnownCard(card)) return { ok: false, status: 404, error: `No card called ${card}.` };
  const url = normalizeFavoriteUrl(body.url);
  if (!url) {
    return { ok: false, status: 400, error: 'url must be a picture already in the house: /api/studio/gallery/<file> or /api/files/<id>.' };
  }
  const list = readFavorites(card);
  const existing = list.find((f) => f.url === url);
  if (existing) return { ok: true, favorites: list, favorite: existing };
  if (list.length >= FAVORITES_MAX) {
    return { ok: false, status: 400, error: `This card already holds ${FAVORITES_MAX} favorites; take one off first.` };
  }
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, FAVORITE_NOTE_MAX) : null;
  const favorite: Favorite = { id: randomUUID(), url, by, note, addedAt: new Date().toISOString() };
  const next = [favorite, ...list];
  writeFavorites(card, next);
  return { ok: true, favorites: next, favorite };
}

export function removeFavorite(card: string, id: string): FavoriteResult {
  if (!isKnownCard(card)) return { ok: false, status: 404, error: `No card called ${card}.` };
  const list = readFavorites(card);
  const next = list.filter((f) => f.id !== id);
  if (next.length === list.length) return { ok: false, status: 404, error: 'That favorite is not on this card.' };
  writeFavorites(card, next);
  return { ok: true, favorites: next };
}
