// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * Choosing which of the owner's pinned places the phone actually watches.
 *
 * The server answers with every place that has something waiting. Android will
 * not hold more than a hundred registered regions per app, so somebody has to
 * decide what happens at a hundred and one — and doing that by proximity is off
 * the table by design, because nothing on this side is allowed to know where
 * the owner is. So the tiebreak is what is waiting: the places holding the most go
 * first, and a stable name sort keeps the same hundred from shuffling between
 * launches for no reason.
 */

/** Android's hard ceiling on registered regions per application. */
export const MAX_REGIONS = 100;

/** The default circle for a pin that arrived without a usable radius. */
export const DEFAULT_RADIUS_M = 100;

export interface ArmedPlace {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radius_m: number;
  waiting: number;
}

function usableNumber(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/**
 * Normalise whatever the armed endpoint returned into regions the native side
 * can register, dropping anything it could not place on a map. A row with no
 * coordinate is not a smaller region, it is not a region at all.
 */
export function regionsFor(rows: unknown): ArmedPlace[] {
  if (!Array.isArray(rows)) return [];
  const places: ArmedPlace[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const id = typeof r.id === 'string' ? r.id.trim() : '';
    const lat = usableNumber(r.lat);
    const lng = usableNumber(r.lng);
    if (!id || lat === null || lng === null) continue;
    const radius = usableNumber(r.radius_m);
    const waiting = usableNumber(r.waiting);
    places.push({
      id,
      name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : 'somewhere you pinned',
      lat,
      lng,
      radius_m: radius !== null && radius > 0 ? radius : DEFAULT_RADIUS_M,
      waiting: waiting !== null && waiting > 0 ? Math.floor(waiting) : 0,
    });
  }

  places.sort((a, b) => (b.waiting - a.waiting) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return places.slice(0, MAX_REGIONS);
}
