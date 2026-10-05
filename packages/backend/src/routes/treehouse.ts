// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// routes/treehouse.ts — Treehouse API routes
import { Router } from 'express';
import crypto from 'crypto';
import * as treehouse from '../services/treehouse.js';
import { createMessage, updateThreadActivity, getDb } from '../services/db.js';
import { registry } from '../services/ws.js';

const router = Router();

router.get('/treehouse', (req, res) => {
  const info = treehouse.getTreehouseInfo();
  res.json(info);
});

router.get('/treehouse/messages', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 50;
  const before = req.query.before as string | undefined;
  const messages = treehouse.getTreehouseMessages(limit, before);
  res.json(messages);
});

router.get('/threads/:id/is-treehouse', (req, res) => {
  res.json({ isTreehouse: treehouse.isTreehouse(req.params.id) });
});

router.post('/treehouse/post', (req, res) => {
  const { companionSlug, content } = req.body;
  if (!companionSlug || !content) {
    return res.status(400).json({ error: 'companionSlug and content required' });
  }
  const message = treehouse.postToTreehouse(companionSlug, content);
  res.json({ success: true, message });
});

// Generic companion post — any thread, individual companion voice
router.post('/threads/:threadId/companion-post', (req, res) => {
  const { threadId } = req.params;
  const { companionSlug, content } = req.body;

  if (!companionSlug || !content) {
    return res.status(400).json({ error: 'companionSlug and content required' });
  }

  // Verify thread exists
  const db = getDb();
  const thread = db.prepare('SELECT id FROM threads WHERE id = ?').get(threadId);
  if (!thread) {
    return res.status(404).json({ error: 'Thread not found' });
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  createMessage({
    id,
    threadId,
    role: 'companion',
    content,
    contentType: 'text',
    metadata: { companionSlug },
    createdAt: now,
  });

  updateThreadActivity(threadId, now);

  // Broadcast to connected clients
  registry.broadcast({
    type: 'message',
    message: {
      id,
      thread_id: threadId,
      role: 'companion',
      companion_slug: companionSlug,
      content,
      content_type: 'text',
      created_at: now,
    } as any,
  });

  res.json({
    success: true,
    message: { id, companion_slug: companionSlug, content, created_at: now }
  });
});

export default router;
