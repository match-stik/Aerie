// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { Router } from 'express';
import { isLocalhost } from './local.js';
import crypto from 'crypto';
import { createMessage, updateThreadActivity, getDb, getCompanionBySlug } from '../../services/db.js';
import { registry } from '../../services/ws.js';
import { getAerieConfig } from '../../config.js';
import { resolveNoteColor } from '../../services/note-color.js';
import { getStickerByRef } from '../../services/db/stickers.js';

const router = Router();

// Internal: List sticky notes (agent-facing)
router.get('/internal/notes', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }
  const rows = getDb()
    .prepare('SELECT id, text, color, timestamp, sender FROM notes ORDER BY id DESC')
    .all();
  res.json(rows);
});

// Internal: Post a sticky note (agent-facing)
router.post('/internal/note', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }
  const { text, color, sender: explicitSender } = req.body || {};
  if (typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'text is required' });
    return;
  }
  const config = getAerieConfig();
  const id = String(Date.now());
  const ts = new Date().toISOString();
  // A note stores its ROLE now and looks the paint up in whatever palette is
  // live, so a role token is accepted here as well as a raw hex — before this,
  // a note left through this door could re-tint with the theme but could never
  // MEAN a colour.
  const sender = typeof explicitSender === 'string' && explicitSender
    ? explicitSender
    : config.identity.companion_name;

  // Every note this house left through this door came out the default yellow,
  // including ones that knew exactly who was writing — the colours were on the
  // companion rows all along. A PIN rather than a role, deliberately: a role
  // follows their person's palette, and a navy note that turns green when the theme changes
  // has stopped being that companion's note. The shared lane has no single author
  // to sign for, so it keeps the yellow.
  const noteColor = resolveNoteColor({
    explicit: color,
    senderColor: getCompanionBySlug(String(sender).toLowerCase())?.color,
  });
  getDb()
    .prepare('INSERT INTO notes (id, text, color, timestamp, sender) VALUES (?, ?, ?, ?, ?)')
    .run(id, text.trim(), noteColor, ts, sender);
  res.json({ ok: true, id, sender });
});

// Internal: Delete a sticky note by id
router.delete('/internal/note/:id', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }
  const id = String(req.params.id);
  getDb().prepare('DELETE FROM notes WHERE id = ?').run(id);
  res.json({ ok: true });
});

// Internal: Send a sticker to a thread
router.post('/internal/sticker-send', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }

  const { pack, name, threadId } = req.body;
  if (!pack || !name || !threadId) {
    res.status(400).json({ error: 'pack, name, and threadId required' });
    return;
  }

  try {
    const sticker = getStickerByRef(pack, name);
    if (!sticker) {
      res.status(404).json({ error: `Sticker not found: ${pack}/${name}` });
      return;
    }

    const msgId = crypto.randomUUID();
    const now = new Date().toISOString();
    const message = createMessage({
      id: msgId,
      threadId,
      role: 'companion',
      content: sticker.url,
      contentType: 'sticker',
      metadata: { stickerName: sticker.name, packName: pack },
      createdAt: now,
    });

    updateThreadActivity(threadId, now, true);
    registry.broadcast({ type: 'message', message });

    res.json({ success: true, messageId: msgId, sticker: sticker.name });
  } catch (error) {
    console.error('Sticker send error:', error);
    res.status(500).json({ error: 'Failed to send sticker' });
  }
});

export default router;
