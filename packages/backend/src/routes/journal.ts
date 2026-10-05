// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Companion journal — read/manage endpoints for the phone's Journal app.
// Companions write via /api/internal/journal (localhost) — see routes/internal.ts.

import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import {
  listJournalEntries,
  getJournalEntry,
  recallJournalEntry,
  deleteJournalEntry,
  effectiveVividness,
  type JournalEntry,
} from '../services/db.js';

const router = Router();
router.use(authMiddleware);

function serialize(entry: JournalEntry) {
  return { ...entry, effective_vividness: effectiveVividness(entry) };
}

router.get('/', (req, res) => {
  const companionId = typeof req.query.companion === 'string' ? req.query.companion : undefined;
  const entryTypeRaw = typeof req.query.type === 'string' ? req.query.type : undefined;
  const entryType = entryTypeRaw === 'journal' || entryTypeRaw === 'dream' ? entryTypeRaw : undefined;
  const limit = Math.min(parseInt(String(req.query.limit), 10) || 50, 200);
  const offset = parseInt(String(req.query.offset), 10) || 0;
  const { entries, total } = listJournalEntries({ companionId, entryType, limit, offset });
  res.json({ total, entries: entries.map(serialize) });
});

router.get('/:id', (req, res) => {
  const entry = getJournalEntry(String(req.params.id));
  if (!entry) return res.status(404).json({ error: 'Entry not found' });
  res.json(serialize(entry));
});

// Reading a dream from the phone counts as recalling it
router.post('/:id/recall', (req, res) => {
  const entry = recallJournalEntry(String(req.params.id));
  if (!entry) return res.status(404).json({ error: 'Entry not found' });
  res.json(serialize(entry));
});

router.delete('/:id', (req, res) => {
  const deleted = deleteJournalEntry(String(req.params.id));
  if (!deleted) return res.status(404).json({ error: 'Entry not found' });
  res.json({ ok: true });
});

export default router;
