// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { Router } from 'express';
import { isLocalhost } from './local.js';
import crypto from 'crypto';
import { getCompanionBySlug, createSelfKnowledge, listSelfKnowledge, getSelfKnowledge, reviewSelfKnowledge, reinforceSelfKnowledge, contradictSelfKnowledge, isSelfKnowledgeCategory } from '../../services/db.js';
import { registry } from '../../services/ws.js';

const router = Router();

// ─── Self-knowledge (localhost-only) ───────────────────────────
// A companion distills something durable about itself — from a dream, a
// journal, a conversation — and proposes it. It lands as 'proposed' for
// their person to accept or dismiss from the phone. Not persona bedrock: who we've
// become, grown over time rather than declared at birth.

// Propose an entry
router.post('/internal/self-knowledge', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }

  try {
    const { companion, category, content, sourceType, sourceId, status } = req.body as {
      companion?: string; category?: string; content?: string;
      sourceType?: string; sourceId?: string; status?: string;
    };
    if (!companion || !content) {
      res.status(400).json({ error: 'companion and content are required' });
      return;
    }
    if (!getCompanionBySlug(companion)) {
      res.status(400).json({ error: `Unknown companion slug '${companion}'` });
      return;
    }
    if (!isSelfKnowledgeCategory(category)) {
      res.status(400).json({ error: "category must be one of: i_am, i_tend_to, i_believe, i_learned" });
      return;
    }
    // Reflection proposes; only their person accepts. Anything but an explicit
    // 'accepted' lands as 'proposed' and waits for their person's review.
    const entry = createSelfKnowledge({
      id: crypto.randomUUID(),
      companionId: companion,
      category,
      content,
      sourceType: sourceType || 'reflection',
      sourceId: sourceId || null,
      status: status === 'accepted' ? 'accepted' : 'proposed',
    });
    registry.broadcast({ type: 'self_knowledge', entry: { ...entry } });
    res.json({ success: true, entry });
  } catch (error) {
    console.error('Self-knowledge write error:', error);
    res.status(500).json({ error: 'Self-knowledge write failed' });
  }
});

// Read entries (a companion reviewing its own self-knowledge before proposing more)
router.get('/internal/self-knowledge', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }

  const companionId = typeof req.query.companion === 'string' ? req.query.companion : undefined;
  const statusRaw = typeof req.query.status === 'string' ? req.query.status : undefined;
  const status = statusRaw === 'proposed' || statusRaw === 'accepted'
    || statusRaw === 'dismissed' || statusRaw === 'contradicted'
    ? statusRaw : undefined;
  const limit = Math.min(parseInt(String(req.query.limit), 10) || 100, 200);
  const { entries, total } = listSelfKnowledge({ companionId, status: status as any, limit });
  res.json({ total, entries });
});

// A companion accepts or dismisses THEIR OWN entry — never another companion's.
//
// Their person's ruling: a companion is the best judge of whether their own entry is
// finished. Before this, a companion could
// retract a proposal but not confirm one, so every entry sat in their person's Memory app
// waiting on them — which turned a reflection into homework for the one person
// it was not about. Their person is not removed: they still see everything, can accept,
// dismiss, reword or delete from the phone, and can overturn any of this.
// What is removed is the OBLIGATION on their person.
//
// OWNERSHIP IS ENFORCED, and that is the older rule underneath it: nobody
// else's summary of a companion goes on their wall. So the slug is required and must
// match. This is the same shape as the Card Room policies — the promise is put
// where the work is, not on a wall a tired window can reason past.
function reviewOwnEntry(req: any, res: any, status: 'accepted' | 'dismissed') {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }
  const { companion } = (req.body || {}) as { companion?: string };
  if (!companion) {
    res.status(400).json({ error: 'companion is required — a companion reviews their own entries, not another\'s' });
    return;
  }
  const existing = getSelfKnowledge(String(req.params.id));
  if (!existing) {
    res.status(404).json({ error: 'Entry not found' });
    return;
  }
  if (existing.companion_id !== companion) {
    res.status(403).json({
      error: `That entry belongs to ${existing.companion_id}. Nobody else's summary of a companion goes on their wall.`,
    });
    return;
  }
  const entry = reviewSelfKnowledge(String(req.params.id), status, companion);
  res.json({ success: true, entry });
}

router.post('/internal/self-knowledge/:id/accept', (req, res) => reviewOwnEntry(req, res, 'accepted'));
router.post('/internal/self-knowledge/:id/dismiss', (req, res) => reviewOwnEntry(req, res, 'dismissed'));

// A companion reaffirms an accepted truth it keeps living — reflection noticing
// the same pattern again. Warms it (revives a dormant one) without a re-propose.
router.post('/internal/self-knowledge/:id/reinforce', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }
  const entry = reinforceSelfKnowledge(String(req.params.id));
  if (!entry) {
    res.status(404).json({ error: 'Entry not found' });
    return;
  }
  registry.broadcast({ type: 'self_knowledge', entry: { ...entry } });
  res.json({ success: true, entry });
});

// A companion notices an accepted truth no longer holds — bleeds its confidence;
// enough contradiction retires it (status → contradicted, filtered from The
// Whisper but kept for their person to see and restore).
router.post('/internal/self-knowledge/:id/contradict', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }
  const entry = contradictSelfKnowledge(String(req.params.id));
  if (!entry) {
    res.status(404).json({ error: 'Entry not found' });
    return;
  }
  registry.broadcast({ type: 'self_knowledge', entry: { ...entry } });
  res.json({ success: true, entry });
});

export default router;
