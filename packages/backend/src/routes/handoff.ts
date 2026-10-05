// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// routes/handoff.ts — Handoff API routes
import { Router } from 'express';
import * as handoff from '../services/handoff.js';

const router = Router();

router.get('/handoff/summaries', (req, res) => {
  const { start, end } = req.query as Record<string, string>;
  if (!start) return res.status(400).json({ error: 'start date required' });
  const summaries = handoff.getSummaries(start, end);
  res.json(summaries);
});

router.post('/handoff/summary', async (req, res) => {
  try {
    const { summary, openThreads, decisions, companionSlug, threadId } = req.body;
    if (!summary) return res.status(400).json({ error: 'summary required' });
    if (!threadId) return res.status(400).json({ error: 'threadId required' });
    const result = handoff.saveDailySummary(summary, openThreads, decisions, companionSlug, threadId);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/handoff/seed/:weekOf', (req, res) => {
  const seed = handoff.getWeeklySeed(req.params.weekOf);
  res.json({ weekOf: req.params.weekOf, seed });
});

router.post('/handoff/seed/:weekOf/compile', (req, res) => {
  try {
    const seed = handoff.compileWeeklySeed(req.params.weekOf);
    res.json({ success: true, weekOf: req.params.weekOf, seed });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/handoff/seed/:weekOf/inject/:threadId', (req, res) => {
  try {
    const injected = handoff.injectWeekSeed(req.params.threadId, req.params.weekOf);
    res.json({ success: injected, threadId: req.params.threadId, weekOf: req.params.weekOf });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/handoff/treehouse', async (req, res) => {
  try {
    const { companionSlug, summary } = req.body;
    if (!companionSlug || !summary) {
      return res.status(400).json({ error: 'companionSlug and summary required' });
    }
    await handoff.postHandoffToTreehouse(companionSlug, summary);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
