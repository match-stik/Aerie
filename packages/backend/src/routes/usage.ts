// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * Usage event + aggregate endpoints.
 * Ported from Sidney's Thornvale implementation.
 * Mounted in server.ts after auth + CSRF middleware.
 */
import { Router } from 'express';
import {
  listUsageEvents,
  getUsageAggregate,
  getToolCallAggregate,
} from '../services/db/usage.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

router.get('/usage/events', authMiddleware, (req, res) => {
  try {
    const limit = Math.min(parseInt((req.query.limit as string) || '100', 10) || 100, 500);
    const offset = parseInt((req.query.offset as string) || '0', 10) || 0;
    const rows = listUsageEvents({
      limit,
      offset,
      since: req.query.since as string | undefined,
      until: req.query.until as string | undefined,
      threadId: req.query.threadId as string | undefined,
      platform: req.query.platform as string | undefined,
      mode: req.query.mode as 'interactive' | 'autonomous' | undefined,
      model: req.query.model as string | undefined,
    });
    res.json({ events: rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/usage/aggregate', authMiddleware, (req, res) => {
  try {
    const rows = getUsageAggregate({
      since: req.query.since as string | undefined,
      until: req.query.until as string | undefined,
      groupBy: req.query.groupBy as any,
    });
    res.json({ buckets: rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/usage/tools', authMiddleware, (req, res) => {
  try {
    const rows = getToolCallAggregate({
      since: req.query.since as string | undefined,
      until: req.query.until as string | undefined,
    });
    res.json({ tools: rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
