// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { Router } from 'express';
import { isLocalhost } from './local.js';
import { addFieldNote, listFieldNotes, fieldNotesLimit, FieldNoteError } from '../../services/db/field-notes.js';

const router = Router();

// ─── Their person field notes (localhost-only) ──────────────────────────
// The morning look writes a sentence or two for their phone's Field Notes page.
// addFieldNote checks everything and refuses in one plain sentence.

router.post('/internal/field-notes', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }
  try {
    const note = addFieldNote(req.body ?? {});
    res.status(201).json({ note });
  } catch (error) {
    if (error instanceof FieldNoteError) {
      res.status(400).json({ error: error.message });
      return;
    }
    console.error('Field note write error:', error);
    res.status(500).json({ error: 'The field note could not be kept.' });
  }
});

router.get('/internal/field-notes', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }
  res.json({ notes: listFieldNotes(fieldNotesLimit(req.query.limit)) });
});

export default router;
