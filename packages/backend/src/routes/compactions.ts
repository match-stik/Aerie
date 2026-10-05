// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Compactions — the record the owner can actually read.
//
// The event itself is invisible from the owner's side: a lane fills its window, the
// tool squashes the conversation into a summary, and the lane carries on
// under an instruction not to mention it, which left the owner nothing to check.
//
// The reader is services/compaction-log.ts; there is deliberately no writer.

import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { listCompactions } from '../services/compaction-log.js';

const router = Router();
router.use(authMiddleware);

router.get('/', (req, res) => {
  const raw = parseInt(String(req.query.limit ?? ''), 10);
  const limit = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 200) : 50;
  // The summaries are large — 18,000 characters is normal — so the list hands
  // back a preview and the full text arrives only when the owner opens one.
  const full = req.query.full === '1';
  const events = listCompactions(limit).map((e) => ({
    ...e,
    summary: full ? e.summary : e.summary.slice(0, 400),
    truncated: !full && e.summary.length > 400,
  }));
  res.json({ compactions: events });
});

export default router;
