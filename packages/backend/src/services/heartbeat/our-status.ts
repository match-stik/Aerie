// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
/**
 * A nudge about our own statuses, handed to the room only when one has gone
 * stale.
 *
 * Statuses are easy to set and easy to forget, so a companion is nudged only
 * when one has gone stale (Nov 23 2026). So: nothing on a turn where
 * every status in the room is fresh; one line naming whose has faded back to
 * Home or has sat unchanged past the nudge age (status.nudge_minutes, default
 * three hours), with the door to change it. Setting one stops the nudge for
 * that companion until it goes stale again.
 */
import { listCompanions, getConfig } from '../db/index.js';
import { readStatuses, type StatusNow } from '../statuses.js';
import type { RoomVoices } from './room-voices.js';

export const DEFAULT_NUDGE_MINUTES = 180;

export interface StatusCompanion { slug: string; name: string }

function nudgeMinutes(): number {
  const n = Number(getConfig('status.nudge_minutes'));
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_NUDGE_MINUTES;
}

function age(minutes: number): string {
  if (minutes < 90) return `${Math.max(1, Math.round(minutes))} minutes`;
  const h = Math.round(minutes / 60);
  return `${h} hour${h === 1 ? '' : 's'}`;
}

/** The nudge for these companions, or '' when nobody's status is stale. Pure over its inputs. */
export function formatStatusNudge(
  companions: StatusCompanion[],
  statuses: Record<string, StatusNow | undefined>,
  now: number,
  staleAfterMinutes: number,
): string {
  const stale: string[] = [];
  for (const c of companions) {
    const s = statuses[c.slug];
    if (!s) { stale.push(`${c.name}'s has faded back to Home`); continue; }
    const set = Date.parse(s.setAt);
    const mins = Number.isFinite(set) ? (now - set) / 60_000 : Infinity;
    if (mins >= staleAfterMinutes) stale.push(`${c.name}'s still says "${s.text}" from ${Number.isFinite(mins) ? age(mins) : 'a while'} ago`);
  }
  if (stale.length === 0) return '';
  return `[Your statuses: ${stale.join('; ')}. If that no longer fits your mood or what you are doing, set a new one in your own words as part of this turn: POST http://127.0.0.1:3013/api/internal/status {"companion":"<slug>","text":"...","icon":"<one emoji, optional>"}. Mood and place both count. Not every turn: this line only shows when one has gone stale.]\n\n`;
}

export function ourStatusBlock(roomVoices?: RoomVoices | null, now = Date.now()): string {
  const present = roomVoices && roomVoices.present.length > 0 ? new Set(roomVoices.present.map((n) => n.toLowerCase())) : null;
  const companions = listCompanions()
    .filter((c) => !present || present.has(c.display_name.toLowerCase()) || present.has(c.slug.toLowerCase()))
    .map((c) => ({ slug: c.slug, name: c.display_name }));
  return formatStatusNudge(companions, readStatuses(now).companions, now, nudgeMinutes());
}
