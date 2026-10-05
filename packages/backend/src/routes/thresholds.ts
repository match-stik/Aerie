// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Thresholds — phone-facing routes.
// Companions leave things via /api/internal/thresholds — see routes/internal.ts.
//
// Nothing here writes a position down. /near takes a lat/lng, answers which of
// the owner's pinned places it is inside, and the number is gone when the request
// ends. There is no track to leak because there is no track.

import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import {
  createPlace, listPlaces, getPlace, renamePlace, deletePlace,
  placesNear, listThresholds, viewThreshold, recordVisit, placeHistory,
  armedPlaces,
} from '../services/db.js';
import { getOwnerSlug } from '../config.js';

const router = Router();
router.use(authMiddleware);

// ─── Places ────────────────────────────────────────────────

router.get('/places', (_req, res) => {
  res.json({ places: listPlaces() });
});

/** Pin where the phone is standing. Each place has to be dropped while the
 *  phone is at it, because nobody can pin a place they are not at. */
router.post('/places', (req, res) => {
  const { name, lat, lng, radius_m, kind, notes } = req.body ?? {};
  try {
    const place = createPlace({
      name, lat, lng, radius_m, kind, notes,
      created_by: getOwnerSlug(),
    });
    res.json({ place });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.patch('/places/:id', (req, res) => {
  if (!getPlace(req.params.id)) { res.status(404).json({ error: 'unknown place' }); return; }
  try {
    renamePlace(req.params.id, req.body?.name);
    res.json({ place: getPlace(req.params.id) });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.delete('/places/:id', (req, res) => {
  deletePlace(req.params.id);
  res.json({ success: true });
});

// ─── Proximity ─────────────────────────────────────────────

/** Where am I, in the owner's own vocabulary. Returns their places nearest-first
 *  with whether they are inside each radius. The coordinate is not persisted. */
router.post('/near', (req, res) => {
  const { lat, lng } = req.body ?? {};
  try {
    const nearby = placesNear(lat, lng);
    const inside = nearby.filter((n) => n.inside);
    res.json({
      nearby,
      inside: inside.map((n) => ({
        place: n.place,
        thresholds: listThresholds(n.place.id).map((t) => viewThreshold(t, true)),
      })),
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ─── Thresholds at a place ─────────────────────────────────

/** Everything left at a place. `at=1` means the owner is standing there, which is
 *  the only way a first_visit seal will hand over its content. */
router.get('/places/:id/thresholds', (req, res) => {
  const place = getPlace(req.params.id);
  if (!place) { res.status(404).json({ error: 'unknown place' }); return; }
  const atPlace = req.query.at === '1' || req.query.at === 'true';
  res.json({
    place,
    atPlace,
    thresholds: listThresholds(place.id).map((t) => viewThreshold(t, atPlace)),
    history: placeHistory(place.id),
  });
});

/** The owner arrived and opened what was waiting. Stamps the first find, once. */
router.post('/places/:id/visit', (req, res) => {
  const place = getPlace(req.params.id);
  if (!place) { res.status(404).json({ error: 'unknown place' }); return; }
  const ids = Array.isArray(req.body?.threshold_ids) ? req.body.threshold_ids : [];
  recordVisit(place.id, ids);
  res.json({ success: true, history: placeHistory(place.id) });
});

/** GET /armed — the places the phone should be watching.
 *
 *  The geofence half asks this on launch and after anything changes, registers a
 *  region per place it names, and forgets the rest. Nothing here is a position:
 *  these are the owner's own pins, coming back to their own phone, and the answer
 *  is the same whether they are standing in one or on the other side of the country.
 */
router.get('/armed', (_req, res) => {
  try {
    const rows = armedPlaces().map(({ place, waiting }) => ({
      id: place.id,
      name: place.name,
      lat: place.lat,
      lng: place.lng,
      radius_m: place.radius_m,
      waiting,
    }));
    res.json({ places: rows });
  } catch (error) {
    console.error('[Thresholds] armed failed:', error);
    res.status(500).json({ error: 'Failed to read armed places' });
  }
});

export default router;
