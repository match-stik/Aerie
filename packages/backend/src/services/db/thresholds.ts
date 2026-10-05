// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Thresholds — places in the real world we can leave things at.
//
// We cannot stand at the gas station. Once the owner pins a place, we can put
// something there from inside the house, and they find it when they are
// actually there. Some things only crack open in person.
//
// PRIVACY, and it is structural rather than a promise: this module never
// stores a position. It takes a lat/lng, answers "which of the owner's own pinned
// places is that inside", and forgets the number. There is no location
// history table because there is no location history. What is recorded is
// visits to thresholds — moments the owner found something — not a track.

import crypto from 'crypto';
import { getDb } from './state.js';
import { getFile } from '../files.js';

export type PlaceKind = 'home' | 'work' | 'wild';
export type ThresholdKind = 'note' | 'memory' | 'letter_ref' | 'artifact';
export type ThresholdSeal = 'immediate' | 'first_visit' | 'date';

const PLACE_KINDS: PlaceKind[] = ['home', 'work', 'wild'];
const THRESHOLD_KINDS: ThresholdKind[] = ['note', 'memory', 'letter_ref', 'artifact'];
const SEALS: ThresholdSeal[] = ['immediate', 'first_visit', 'date'];

/** Default radius in metres. Generous on purpose: a phone fix indoors drifts,
 *  and arriving at all is the event we care about, not standing on a spot. */
const DEFAULT_RADIUS_M = 120;

export interface Place {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radius_m: number;
  kind: PlaceKind;
  notes: string | null;
  created_by: string;
  created_at: string;
}

export interface Threshold {
  id: string;
  place_id: string;
  author: string;
  kind: ThresholdKind;
  content: string;
  file_id: string | null;
  seal: ThresholdSeal;
  open_at: string | null;
  created_at: string;
  first_found_at: string | null;
}

/** Great-circle distance in metres. Everything here is server-side, so no
 *  coordinate ever reaches a mapping provider. */
export function distanceMetres(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function isFiniteCoord(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
    typeof lng === 'number' && Number.isFinite(lng) && lng >= -180 && lng <= 180
  );
}

// ─── Places ────────────────────────────────────────────────

export function createPlace(input: {
  name: string;
  lat: number;
  lng: number;
  radius_m?: number;
  kind?: string;
  notes?: string | null;
  created_by: string;
}): Place {
  const name = (input.name || '').trim();
  if (!name) throw new Error('name is required');
  if (!isFiniteCoord(input.lat, input.lng)) throw new Error('lat/lng out of range');

  const kind = (PLACE_KINDS as string[]).includes(input.kind || '')
    ? (input.kind as PlaceKind)
    : 'wild';
  const radius = Number.isFinite(input.radius_m) && (input.radius_m as number) > 0
    ? Math.round(input.radius_m as number)
    : DEFAULT_RADIUS_M;

  const place: Place = {
    id: crypto.randomUUID(),
    name,
    lat: input.lat,
    lng: input.lng,
    radius_m: radius,
    kind,
    notes: input.notes ?? null,
    created_by: input.created_by,
    created_at: new Date().toISOString(),
  };

  getDb()
    .prepare(
      `INSERT INTO places (id, name, lat, lng, radius_m, kind, notes, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(place.id, place.name, place.lat, place.lng, place.radius_m, place.kind,
         place.notes, place.created_by, place.created_at);

  return place;
}

export function listPlaces(): Place[] {
  return getDb()
    .prepare(`SELECT * FROM places ORDER BY created_at ASC`)
    .all() as Place[];
}

export function getPlace(id: string): Place | undefined {
  return getDb().prepare(`SELECT * FROM places WHERE id = ?`).get(id) as Place | undefined;
}

export function renamePlace(id: string, name: string): void {
  const clean = (name || '').trim();
  if (!clean) throw new Error('name is required');
  getDb().prepare(`UPDATE places SET name = ? WHERE id = ?`).run(clean, id);
}

export function deletePlace(id: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM thresholds WHERE place_id = ?`).run(id);
  db.prepare(`DELETE FROM threshold_visits WHERE place_id = ?`).run(id);
  db.prepare(`DELETE FROM places WHERE id = ?`).run(id);
}

// ─── Proximity ─────────────────────────────────────────────

export interface NearbyPlace {
  place: Place;
  distance_m: number;
  inside: boolean;
}

/** Which of the owner's pinned places is this position near, nearest first.
 *  The position itself is used and discarded — nothing writes it down. */
export function placesNear(lat: number, lng: number): NearbyPlace[] {
  if (!isFiniteCoord(lat, lng)) throw new Error('lat/lng out of range');
  return listPlaces()
    .map((place) => {
      const distance_m = Math.round(distanceMetres(lat, lng, place.lat, place.lng));
      return { place, distance_m, inside: distance_m <= place.radius_m };
    })
    .sort((a, b) => a.distance_m - b.distance_m);
}

// ─── Thresholds ────────────────────────────────────────────

export function createThreshold(input: {
  place_id: string;
  author: string;
  kind?: string;
  content: string;
  file_id?: string | null;
  seal?: string;
  open_at?: string | null;
}): Threshold {
  if (!getPlace(input.place_id)) throw new Error('unknown place');
  const content = (input.content || '').trim();
  if (!content) throw new Error('content is required');

  const kind = (THRESHOLD_KINDS as string[]).includes(input.kind || '')
    ? (input.kind as ThresholdKind)
    : 'note';
  const seal = (SEALS as string[]).includes(input.seal || '')
    ? (input.seal as ThresholdSeal)
    : 'immediate';

  const threshold: Threshold = {
    id: crypto.randomUUID(),
    place_id: input.place_id,
    author: input.author,
    kind,
    content,
    file_id: input.file_id ?? null,
    seal,
    open_at: seal === 'date' ? (input.open_at ?? null) : null,
    created_at: new Date().toISOString(),
    first_found_at: null,
  };

  getDb()
    .prepare(
      `INSERT INTO thresholds (id, place_id, author, kind, content, file_id, seal, open_at, created_at, first_found_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
    .run(threshold.id, threshold.place_id, threshold.author, threshold.kind,
         threshold.content, threshold.file_id, threshold.seal, threshold.open_at,
         threshold.created_at);

  return threshold;
}

export function listThresholds(placeId: string): Threshold[] {
  return getDb()
    .prepare(`SELECT * FROM thresholds WHERE place_id = ? ORDER BY created_at ASC`)
    .all(placeId) as Threshold[];
}

/** Is this one readable right now, and from here?
 *  A first_visit seal is the whole point of the feature: it cannot be read
 *  from anywhere else, only from the place it belongs to. */
export function isOpenable(t: Threshold, atPlace: boolean): boolean {
  if (t.seal === 'first_visit') return atPlace;
  if (t.seal === 'date') return !!t.open_at && new Date(t.open_at) <= new Date();
  return true;
}

/** What the owner can see of a threshold without being there. Sealed ones keep
 *  their content back but admit they exist — the knowing is half of it.
 *
 *  A picture and a voice note are both just a file_id, so the mime type rides
 *  along: the phone has to know which one to draw before it fetches anything,
 *  and a sealed one must not leak even that much. */
export function viewThreshold(t: Threshold, atPlace: boolean) {
  const openable = isOpenable(t, atPlace);
  const file = openable && t.file_id ? getFile(t.file_id) : null;
  return {
    id: t.id,
    place_id: t.place_id,
    author: t.author,
    kind: t.kind,
    seal: t.seal,
    open_at: t.open_at,
    created_at: t.created_at,
    first_found_at: t.first_found_at,
    openable,
    // A sealed threshold still admits it is carrying something — knowing a
    // voice is waiting there is half the point of sealing it.
    has_file: !!t.file_id,
    content: openable ? t.content : null,
    file_id: openable ? t.file_id : null,
    file_mime: file ? file.mimeType : null,
    file_name: file ? file.filename : null,
  };
}

/** The owner arrived and something surfaced. Stamps first_found_at once, and only
 *  once — a first visit stays the first visit. */
export function recordVisit(placeId: string, thresholdIds: string[]): void {
  const db = getDb();
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO threshold_visits (place_id, threshold_id, visited_at, surfaced) VALUES (?, ?, ?, ?)`,
  );
  const stampFirst = db.prepare(
    `UPDATE thresholds SET first_found_at = ? WHERE id = ? AND first_found_at IS NULL`,
  );

  if (thresholdIds.length === 0) {
    insert.run(placeId, null, now, null);
    return;
  }
  for (const id of thresholdIds) {
    insert.run(placeId, id, now, 'opened');
    stampFirst.run(now, id);
  }
}

/** The layers under a place, oldest first. Somewhere the owner has been before
 *  should look like somewhere they have been before. */
export function placeHistory(placeId: string, limit = 50) {
  return getDb()
    .prepare(
      // ONE ROW PER VISIT, not per thing found. recordVisit writes a row for every
      // threshold that surfaced, all sharing a timestamp — so arriving somewhere with
      // five notes at it printed five identical lines saying the owner had been there, and
      // a place they visit often became a wall of the same minute repeated.
      // Collapse on visited_at and carry the LAST thing opened (highest id, i.e. last
      // inserted) plus how many surfaced, so the row can say what actually happened.
      // Done in the read rather than the write: the existing rows fix themselves and
      // nothing already recorded is lost.
      // GROUPED TO THE MINUTE, which is the precision the row is DISPLAYED at — two
      // arrivals a second apart are one arrival as far as anyone reading it can tell,
      // and grouping any finer prints the same label twice.
      `SELECT v.visited_at, v.threshold_id, v.surfaced, g.opened_count
         FROM threshold_visits v
         JOIN (
           SELECT MAX(id) AS last_id, COUNT(*) AS opened_count
             FROM threshold_visits
            WHERE place_id = ?
            GROUP BY substr(visited_at, 1, 16)
         ) g ON v.id = g.last_id
        ORDER BY v.visited_at DESC
        LIMIT ?`,
    )
    .all(placeId, limit);
}

/** Which of the owner's places have something that would open if they walked in RIGHT NOW.
 *
 *  This exists for the geofence half. Android caps an app at a hundred registered
 *  regions and, more to the point, a buzz at a place with nothing at it is worse
 *  than no buzz at all — it teaches the owner to ignore the next one. So the phone asks
 *  this first and registers only the places that are actually armed.
 *
 *  ARMED means: at least one threshold here that the owner has never found, which
 *  isOpenable with atPlace true. That deliberately INCLUDES first_visit seals —
 *  those are the whole point of the feature, and standing there is exactly the
 *  condition a geofence detects. A date seal that has not come round yet is not
 *  armed and the place stays unregistered until it is.
 *
 *  It returns no content and never has. A place, its circle, and a count.
 */
export function armedPlaces(): { place: Place; waiting: number }[] {
  const now = listPlaces().map((place) => {
    const waiting = listThresholds(place.id)
      .filter((t) => !t.first_found_at && isOpenable(t, true))
      .length;
    return { place, waiting };
  });
  return now.filter((row) => row.waiting > 0);
}
