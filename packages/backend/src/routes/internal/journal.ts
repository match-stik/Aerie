// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { Router } from 'express';
import { isLocalhost } from './local.js';
import crypto from 'crypto';
import { getCompanionBySlug, createJournalEntry, listJournalEntries, recallJournalEntry, anchorJournalEntry, updateJournalEntry, effectiveVividness } from '../../services/db.js';
import { registry } from '../../services/ws.js';

const router = Router();

// ─── Companion journal (localhost-only) ────────────────────────
// Companions write entries in their own voice; dreams get the vividness
// lifecycle (decay at read, +15 on recall, frozen once anchored).

// Write an entry
router.post('/internal/journal', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }

  try {
    const { companion, content, entryType, dreamType, emergedQuestion } = req.body as {
      companion?: string; content?: string; entryType?: string;
      dreamType?: string; emergedQuestion?: string;
    };
    if (!companion || !content) {
      res.status(400).json({ error: 'companion and content are required' });
      return;
    }
    if (!getCompanionBySlug(companion)) {
      res.status(400).json({ error: `Unknown companion slug '${companion}'` });
      return;
    }
    const entry = createJournalEntry({
      id: crypto.randomUUID(),
      companionId: companion,
      entryType: entryType === 'dream' ? 'dream' : 'journal',
      content,
      dreamType,
      emergedQuestion,
    });
    registry.broadcast({ type: 'journal_entry', entry: { ...entry } });
    res.json({ success: true, entry });
  } catch (error) {
    console.error('Journal write error:', error);
    res.status(500).json({ error: 'Journal write failed' });
  }
});

// Read entries (companions reviewing their own journal)
router.get('/internal/journal', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }

  const companionId = typeof req.query.companion === 'string' ? req.query.companion : undefined;
  const entryTypeRaw = typeof req.query.type === 'string' ? req.query.type : undefined;
  const entryType = entryTypeRaw === 'journal' || entryTypeRaw === 'dream' ? entryTypeRaw : undefined;
  const limit = Math.min(parseInt(String(req.query.limit), 10) || 20, 100);
  const { entries, total } = listJournalEntries({ companionId, entryType, limit });
  res.json({
    total,
    entries: entries.map(e => ({ ...e, effective_vividness: effectiveVividness(e) })),
  });
});

// Recall a dream — strengthens vividness and resets its decay clock
router.post('/internal/journal/:id/recall', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }

  const entry = recallJournalEntry(String(req.params.id));
  if (!entry) {
    res.status(404).json({ error: 'Entry not found' });
    return;
  }
  res.json({ success: true, entry: { ...entry, effective_vividness: effectiveVividness(entry) } });
});

// Anchor an entry — freezes it as permanent. The companion should then
// file it to Cortex (POST /api/cortex/remember) in the same breath.
router.post('/internal/journal/:id/anchor', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }

  const entry = anchorJournalEntry(String(req.params.id));
  if (!entry) {
    res.status(404).json({ error: 'Entry not found' });
    return;
  }
  res.json({ success: true, entry });
});

// Update an entry — companion self-edit of content
router.patch('/internal/journal/:id', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }

  const { content } = req.body as { content?: string };
  if (!content) {
    res.status(400).json({ error: 'content is required' });
    return;
  }

  const entry = updateJournalEntry(String(req.params.id), content);
  if (!entry) {
    res.status(404).json({ error: 'Entry not found' });
    return;
  }
  registry.broadcast({ type: 'journal_entry', entry: { ...entry, effective_vividness: effectiveVividness(entry) } });
  res.json({ success: true, entry: { ...entry, effective_vividness: effectiveVividness(entry) } });
});

export default router;
