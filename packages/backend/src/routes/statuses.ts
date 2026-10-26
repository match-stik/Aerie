// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Their phone's side of the statuses (services/statuses.ts): read them all, and
// change any one of them from a contact card or the sheet under the faces.
// Behind the owner login. The companions set theirs through the loopback door,
// POST /api/internal/status.

import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { readStatuses, setStatus } from '../services/statuses.js';

const router = Router();
router.use(authMiddleware);

router.get('/', (_req, res) => {
  res.json(readStatuses());
});

router.put('/:who', (req, res) => {
  const result = setStatus(req.params.who, req.body ?? {}, 'owner');
  if (!result.ok) {
    res.status(400).json({ ok: false, error: result.error });
    return;
  }
  res.json({ ok: true, ...result.statuses });
});

export default router;
