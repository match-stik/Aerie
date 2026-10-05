// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Self-knowledge — phone-facing endpoints for the Memory app.
// Companions propose entries via /api/internal/self-knowledge (localhost —
// see routes/internal.ts). Here the owner reviews them: accept into identity,
// dismiss, refine the wording, or delete.

import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import {
  listSelfKnowledge,
  reviewSelfKnowledge,
  updateSelfKnowledgeContent,
  deleteSelfKnowledge,
  isSelfKnowledgeCategory,
  effectiveHeat,
  type SelfKnowledgeCategory,
  type SelfKnowledgeStatus,
} from '../services/db.js';

const router = Router();
router.use(authMiddleware);

router.get('/', (req, res) => {
  const companionId = typeof req.query.companion === 'string' ? req.query.companion : undefined;
  const categoryRaw = typeof req.query.category === 'string' ? req.query.category : undefined;
  const category = isSelfKnowledgeCategory(categoryRaw) ? categoryRaw as SelfKnowledgeCategory : undefined;
  const statusRaw = typeof req.query.status === 'string' ? req.query.status : undefined;
  const status = statusRaw === 'proposed' || statusRaw === 'accepted'
    || statusRaw === 'dismissed' || statusRaw === 'contradicted'
    ? statusRaw as SelfKnowledgeStatus : undefined;
  const limit = Math.min(parseInt(String(req.query.limit), 10) || 100, 200);
  const offset = parseInt(String(req.query.offset), 10) || 0;
  const { entries, total } = listSelfKnowledge({ companionId, category, status, limit, offset });
  // heat decays at read (dream-vividness mechanic) — surface the live value so
  // the phone shows current warmth, not the last stored snapshot.
  const withHeat = entries.map((e) => ({ ...e, effective_heat: effectiveHeat(e) }));
  res.json({ total, entries: withHeat });
});

// Accept a proposed entry into identity, or dismiss it.
router.post('/:id/review', (req, res) => {
  const { status } = req.body as { status?: string };
  if (status !== 'accepted' && status !== 'dismissed') {
    return res.status(400).json({ error: "status must be 'accepted' or 'dismissed'" });
  }
  const entry = reviewSelfKnowledge(String(req.params.id), status);
  if (!entry) return res.status(404).json({ error: 'Entry not found' });
  res.json(entry);
});

// Refine the wording.
router.patch('/:id', (req, res) => {
  const { content } = req.body as { content?: string };
  if (!content || !content.trim()) return res.status(400).json({ error: 'content is required' });
  const entry = updateSelfKnowledgeContent(String(req.params.id), content.trim());
  if (!entry) return res.status(404).json({ error: 'Entry not found' });
  res.json(entry);
});

router.delete('/:id', (req, res) => {
  const deleted = deleteSelfKnowledge(String(req.params.id));
  if (!deleted) return res.status(404).json({ error: 'Entry not found' });
  res.json({ ok: true });
});

export default router;
