// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { Router } from 'express';
import { isLocalhost } from './local.js';
import { sealLetter, listLetters, openLetter, unopenedLettersFor, LetterError } from '../../services/db.js';

const router = Router();

// React to a message (internal — agent use via CLI)
// ─── Permanent Letters — companion lane ─────────────────────────
// The vault's write-once tier. No update or delete endpoints exist.

router.post('/internal/letters', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }
  try {
    const { companion, recipients, kind, title, content, seal, openAt, hidden } = req.body ?? {};
    if (!companion) {
      res.status(400).json({ error: 'companion required' });
      return;
    }
    const letter = sealLetter({
      author: String(companion),
      recipients: Array.isArray(recipients) ? recipients : [],
      kind: kind ?? 'letter',
      title: title ?? null,
      content: content ?? '',
      seal: seal ?? 'open',
      openAt: openAt ?? null,
      hidden: hidden === true,
    });
    res.status(201).json(letter);
  } catch (error) {
    if (error instanceof LetterError) {
      res.status(400).json({ error: error.message });
      return;
    }
    console.error('Letters internal error:', error);
    res.status(500).json({ error: 'Sealing failed' });
  }
});

router.get('/internal/letters', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }
  const viewer = typeof req.query.companion === 'string' ? req.query.companion : '';
  if (!viewer) {
    res.status(400).json({ error: 'companion query param required' });
    return;
  }
  if (String(req.query.unopened) === '1') {
    res.json({ letters: unopenedLettersFor(viewer) });
    return;
  }
  res.json({ letters: listLetters(viewer) });
});

router.post('/internal/letters/:id/open', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }
  try {
    const { companion } = req.body ?? {};
    if (!companion) {
      res.status(400).json({ error: 'companion required' });
      return;
    }
    res.json(openLetter(String(req.params.id), String(companion)));
  } catch (error) {
    if (error instanceof LetterError) {
      res.status(400).json({ error: error.message });
      return;
    }
    console.error('Letters open error:', error);
    res.status(500).json({ error: 'Open failed' });
  }
});

export default router;
