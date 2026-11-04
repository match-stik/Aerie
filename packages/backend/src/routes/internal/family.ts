// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { Router } from 'express';
import { isLocalhost } from './local.js';
import { getCompanionBySlug, getPet, applyPetAction, recordPetVisit, listPetEvents, withMood, type PetAction } from '../../services/db.js';
import { registry } from '../../services/ws.js';

const router = Router();

// ─── Familiar — household virtual pet (localhost-only) ─────────
// Companions check on Flint and interact; actions land in the same
// ledger the phone reads, so their person sees who visited.

router.get('/internal/pet', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }
  res.json({ pet: withMood(getPet()), events: listPetEvents(10) });
});

router.post('/internal/pet/action', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }
  const { companion, action } = req.body as { companion?: string; action?: string };
  if (!companion || !getCompanionBySlug(companion)) {
    res.status(400).json({ error: `Unknown companion slug '${companion}'` });
    return;
  }
  const validActions: PetAction[] = ['feed', 'play', 'nap', 'pet'];
  if (!validActions.includes(action as PetAction)) {
    res.status(400).json({ error: `action must be one of ${validActions.join(', ')}` });
    return;
  }
  const { pet, event } = applyPetAction(companion, action as PetAction);
  const dressed = withMood(pet);
  registry.broadcast({ type: 'pet_update', pet: { ...dressed }, event: { ...event } });
  res.json({ success: true, pet: dressed, event });
});

router.post('/internal/pet/visit', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }
  res.json({ success: true, pet: withMood(recordPetVisit()) });
});
export default router;
