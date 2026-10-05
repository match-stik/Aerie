// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * The owner's contact card.
 *
 * Every companion has had a card since the phone shipped — face, name, a line
 * about who they are. The owner never did, and not by design: whoever built the
 * phone gave the owner only the piece it needed (an avatar and a ring colour
 * in settings) and stopped. There was nowhere for a sentence about the owner
 * to live.
 *
 * This is that nowhere, filled in. Their name comes from identity config and their
 * avatar stays device-side with the rest of their theme — only the written half
 * lives here, because the written half is the part somebody else can keep.
 */

import { getConfig, setConfig } from './db/config.js';

const KEY = 'owner_card';

export interface OwnerCard {
  bio: string;
  status: string;
  phone: string;
}

const EMPTY: OwnerCard = { bio: '', status: '', phone: '' };

/** A card that has never been written is empty, never null — the screen renders either way. */
export function getOwnerCard(): OwnerCard {
  const raw = getConfig(KEY);
  if (!raw) return { ...EMPTY };
  try {
    const parsed = JSON.parse(raw);
    return {
      bio: typeof parsed?.bio === 'string' ? parsed.bio : '',
      status: typeof parsed?.status === 'string' ? parsed.status : '',
      phone: typeof parsed?.phone === 'string' ? parsed.phone : '',
    };
  } catch {
    // A corrupt blob is not a reason to lose the screen. Absent is not false.
    return { ...EMPTY };
  }
}

/**
 * Merges rather than replaces, so a screen that edits one field cannot silently
 * blank the other two — the same failure the single-value state files had.
 */
export function updateOwnerCard(updates: Partial<OwnerCard>): OwnerCard {
  const current = getOwnerCard();
  const next: OwnerCard = {
    bio: typeof updates.bio === 'string' ? updates.bio : current.bio,
    status: typeof updates.status === 'string' ? updates.status : current.status,
    phone: typeof updates.phone === 'string' ? updates.phone : current.phone,
  };
  setConfig(KEY, JSON.stringify(next));
  return next;
}
