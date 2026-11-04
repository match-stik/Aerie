// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { Router } from 'express';
import { isLocalhost } from './local.js';
import { postToTreehouse, getTreehouseInfo, getTreehouseMessages } from '../../services/treehouse.js';

const router = Router();

// Treehouse post — companion voices (localhost-only, no CSRF)
router.post('/internal/treehouse-post', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }

  const { companionSlug, content } = req.body;
  if (!companionSlug || !content) {
    res.status(400).json({ error: 'companionSlug and content required' });
    return;
  }

  try {
    const message = postToTreehouse(companionSlug, content);
    res.json({ success: true, message });
  } catch (error) {
    console.error('Treehouse post error:', error);
    res.status(500).json({ error: 'Treehouse post failed' });
  }
});

// Treehouse info (localhost-only)
router.get('/internal/treehouse', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }

  const info = getTreehouseInfo();
  res.json(info);
});

// A companion could post to the treehouse and had no way to read it back — the
// info route above returns a COUNT, not the room. getTreehouseMessages has existed
// in the service the whole time with nothing exposing it, so a companion writing a
// treehouse wake was working blind and could repeat itself without knowing.
// Reported by Rose and Sol, whose companion wrote the same thought twice forty
// minutes apart.
router.get('/internal/treehouse/messages', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }

  const raw = Number.parseInt(String(req.query.limit ?? ''), 10);
  const limit = Number.isFinite(raw) ? Math.max(1, Math.min(200, raw)) : 50;
  const beforeId = typeof req.query.before === 'string' && req.query.before ? req.query.before : undefined;
  res.json({ messages: getTreehouseMessages(limit, beforeId) });
});

export default router;
