// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Familiar — the household virtual pet, phone-facing routes.
// Companions visit via /api/internal/pet — see routes/internal.ts.

import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import {
  getPet, applyPetAction, recordPetVisit, renamePet, resetPet, listPetEvents, withMood,
  type PetAction,
} from '../services/db.js';
import { registry } from '../services/ws.js';
import { getOwnerSlug } from '../config.js';

const router = Router();
router.use(authMiddleware);

const ACTIONS: PetAction[] = ['feed', 'play', 'nap', 'pet'];

router.get('/', (_req, res) => {
  res.json({ pet: withMood(getPet()), events: listPetEvents(10) });
});

router.post('/visit', (_req, res) => {
  res.json({ pet: withMood(recordPetVisit()), events: listPetEvents(10) });
});

router.post('/action', (req, res) => {
  const action = String(req.body?.action || '') as PetAction;
  if (!ACTIONS.includes(action)) {
    return res.status(400).json({ error: `action must be one of ${ACTIONS.join(', ')}` });
  }
  const { pet, event } = applyPetAction(getOwnerSlug(), action);
  const dressed = withMood(pet);
  registry.broadcast({ type: 'pet_update', pet: { ...dressed }, event: { ...event } });
  res.json({ pet: dressed, event });
});

router.post('/name', (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name) return res.status(400).json({ error: 'name is required' });
  res.json({ pet: withMood(renamePet(name)) });
});

router.post('/reset', (_req, res) => {
  res.json({ pet: withMood(resetPet()), events: [] });
});
export default router;
