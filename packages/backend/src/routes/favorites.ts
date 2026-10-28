// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Their phone's side of the favorites shelves (services/favorites.ts): read a
// card's shelf, put a picture on it, take one off. Behind the login. The
// companions pick theirs through the loopback door, POST /api/internal/favorites.

import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { readFavorites, addFavorite, removeFavorite, isKnownCard, OWNER_CARD } from '../services/favorites.js';

const router = Router();
router.use(authMiddleware);

router.get('/:card', (req, res) => {
  const card = req.params.card;
  if (!isKnownCard(card)) {
    res.status(404).json({ ok: false, error: `No card called ${card}.` });
    return;
  }
  res.json({ ok: true, card, favorites: readFavorites(card) });
});

router.post('/:card', (req, res) => {
  const result = addFavorite(req.params.card, req.body ?? {}, OWNER_CARD);
  if (!result.ok) {
    res.status(result.status).json({ ok: false, error: result.error });
    return;
  }
  res.json(result);
});

router.delete('/:card/:id', (req, res) => {
  const result = removeFavorite(req.params.card, req.params.id);
  if (!result.ok) {
    res.status(result.status).json({ ok: false, error: result.error });
    return;
  }
  res.json(result);
});

export default router;
