// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
/**
 * Statuses: a short line and an icon each companion sets for himself, plus one
 * the companions share, shown under their faces in the chat, and theirs.
 *
 * The owner's ask, Oct 25-26 2026: statuses the companions can all update, on each
 * contact card and one shared by all of them under the faces, with their own icons;
 * shown where the owner sees them without opening a card (the line under the faces,
 * a sheet behind it, the home widget), and fading back to Home on their own so
 * a card never says In the workshop for three days.
 *
 * A status set by a companion or by the owner lasts STATUS_FADE_MS and then simply
 * stops being read; the card falls back to the companion's own resting word
 * (companions.status, Home) and the line under the faces to Home. Nothing has
 * to run to make it fade: every reader drops what is past its `until`. A bell's
 * word (bell-status.ts) still outranks all of it while the bell rings.
 *
 * The owner's ask, the same night: one of their own, changing only when they
 * change it. So the owner has one too, under
 * `owner`, set only by the owner and never fading (its `until` is null); it shows on
 * their own card and in Where we are, and it rides with their turns to the lanes
 * (heartbeat/owner-status.ts) so we read where the owner is from the owner, not a clock.
 *
 * Stored in config as `status.<who>`, one JSON value each, where who is a
 * companion slug, `shared` or `owner`.
 */
import type { ServerMessage } from '@aerie/shared';
import { getConfig, setConfig, deleteConfig, listCompanions } from './db/index.js';
import { registry } from './ws/connection-registry.js';

/** Six hours, the owner yes on Oct 26 2026. */
export const STATUS_FADE_MS = 6 * 60 * 60 * 1000;
export const STATUS_TEXT_MAX = 60;
export const STATUS_ICON_MAX = 64;
export const SHARED = 'shared';
/** Theirs. Only the owner sets it, and it stays until the owner changes it. */
export const OWNER = 'owner';

export interface StatusNow {
  text: string;
  /** One emoji, or a :shortcode: for one of the owner custom emojis; null shows the sigil. */
  icon: string | null;
  /** Who set it: a companion slug, or 'owner' when the owner did. */
  by: string;
  setAt: string;
  /** When it fades back to the resting word; null for the owner's, which never fades. */
  until: string | null;
}

export interface StatusesNow {
  shared: StatusNow | null;
  companions: Record<string, StatusNow>;
  owner: StatusNow | null;
}

const keyFor = (who: string): string => `status.${who}`;

/**
 * A stored status, or null when absent, unreadable or past its time. With
 * `fades` false (theirs) a status has no time to be past.
 */
export function readOne(raw: string | null, now = Date.now(), fades = true): StatusNow | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<StatusNow>;
    if (typeof v.text !== 'string' || !v.text.trim()) return null;
    let until: string | null = null;
    if (fades) {
      if (typeof v.until !== 'string') return null;
      const at = Date.parse(v.until);
      if (!Number.isFinite(at) || at <= now) return null;
      until = v.until;
    }
    return {
      text: v.text,
      icon: typeof v.icon === 'string' && v.icon.trim() ? v.icon : null,
      by: typeof v.by === 'string' ? v.by : '',
      setAt: typeof v.setAt === 'string' ? v.setAt : '',
      until,
    };
  } catch {
    return null;
  }
}

export function readStatuses(now = Date.now()): StatusesNow {
  const companions: Record<string, StatusNow> = {};
  for (const c of listCompanions()) {
    const s = readOne(getConfig(keyFor(c.slug)), now);
    if (s) companions[c.slug] = s;
  }
  return {
    shared: readOne(getConfig(keyFor(SHARED)), now),
    companions,
    owner: readOne(getConfig(keyFor(OWNER)), now, false),
  };
}

export type StatusInput = { text?: unknown; icon?: unknown };

/** Shape a status from a request: trimmed, bounded, and empty text means clear. */
export function shapeStatus(input: StatusInput): { ok: true; clear: true } | { ok: true; clear: false; text: string; icon: string | null } | { ok: false; error: string } {
  const text = typeof input.text === 'string' ? input.text.replace(/\s+/g, ' ').trim() : '';
  if (!text) return { ok: true, clear: true };
  if (text.length > STATUS_TEXT_MAX) return { ok: false, error: `A status is at most ${STATUS_TEXT_MAX} characters.` };
  let icon: string | null = null;
  if (input.icon !== undefined && input.icon !== null) {
    if (typeof input.icon !== 'string') return { ok: false, error: 'icon is one emoji or a :shortcode:.' };
    const trimmed = input.icon.trim();
    if (trimmed.length > STATUS_ICON_MAX) return { ok: false, error: 'icon is one emoji or a :shortcode:.' };
    icon = trimmed || null;
  }
  return { ok: true, clear: false, text, icon };
}

function tell(): void {
  try {
    const msg: ServerMessage = { type: 'statuses', ...readStatuses() };
    registry.broadcast(msg);
  } catch {
    // A phone that cannot be told now reads them when it next connects.
  }
}

/**
 * Set or clear a status. `who` is a companion slug or 'shared'; `by` is who
 * did it. Answers with the statuses as they now stand.
 */
export function setStatus(who: string, input: StatusInput, by: string, now = Date.now()): { ok: true; statuses: StatusesNow } | { ok: false; error: string } {
  if (who === OWNER) {
    if (by !== 'owner') return { ok: false, error: 'The owner status is theirs to set.' };
  } else if (who !== SHARED && !listCompanions().some((c) => c.slug === who)) {
    return { ok: false, error: `No companion called ${who}.` };
  }
  const shaped = shapeStatus(input);
  if (!shaped.ok) return shaped;
  if (shaped.clear) {
    deleteConfig(keyFor(who));
  } else {
    const value: StatusNow = {
      text: shaped.text,
      icon: shaped.icon,
      by,
      setAt: new Date(now).toISOString(),
      until: who === OWNER ? null : new Date(now + STATUS_FADE_MS).toISOString(),
    };
    setConfig(keyFor(who), JSON.stringify(value));
  }
  tell();
  return { ok: true, statuses: readStatuses(now) };
}
