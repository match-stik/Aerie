// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The owner's phone's side of the road from a lane to the toys: what it says
// about the toys whenever they change (POST /api/toys/state), and its answer
// to each command a lane sent (POST /api/toys/ack). Behind the owner's login,
// because only the owner's own phone has anything to say here.

import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { recordPhoneState, recordToyAck } from '../services/toy-remote.js';

const router = Router();
router.use(authMiddleware);

router.post('/state', (req, res) => {
  if (!recordPhoneState(req.body)) {
    res.status(400).json({ ok: false, error: 'Not a toy state' });
    return;
  }
  res.json({ ok: true });
});

router.post('/ack', (req, res) => {
  res.json({ ok: true, matched: recordToyAck(req.body) });
});

export default router;
