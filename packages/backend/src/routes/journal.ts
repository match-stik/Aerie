// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
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
import { renderAloud, ReadAloudError } from './api/message-tts.js';
import { VoiceService } from '../services/voice.js';

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

/**
 * An entry read aloud in its own writer's voice, kept after the first time
 * like a message's. The entry has no header of its own, so it is read
 * under its writer's name, which is how the voice is chosen.
 */
router.post('/:id/tts', async (req, res) => {
  const entry = getJournalEntry(String(req.params.id));
  if (!entry) return res.status(404).json({ error: 'Entry not found' });
  const writer = VoiceService.getVoiceCompanions().find((c) => c.slug === entry.companion_id);
  const words = [entry.content, entry.emerged_question && !entry.content.includes(entry.emerged_question) ? entry.emerged_question : null]
    .filter(Boolean).join('\n\n');
  const text = writer ? `**${writer.display_name}**\n${words}` : words;
  try {
    const made = await renderAloud(`journal:${entry.id}`, text, req.app.locals.voiceService as VoiceService | undefined);
    res.json({ success: true, ...made });
  } catch (error) {
    if (error instanceof ReadAloudError) { res.status(error.status).json({ error: error.message }); return; }
    console.error('[journal] read aloud failed:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'The read-aloud did not render' });
  }
});

router.delete('/:id', (req, res) => {
  const deleted = deleteJournalEntry(String(req.params.id));
  if (!deleted) return res.status(404).json({ error: 'Entry not found' });
  res.json({ ok: true });
});

export default router;
