// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * Codex OAuth routes — start login, poll status, submit manual code, logout.
 *
 * Mounted under `/api/auth/codex` from routes/api.ts. All routes sit behind
 * the existing authMiddleware + csrfProtection (POST routes need an
 * x-csrf-token header; apiFetch on the frontend handles this automatically).
 *
 * Pattern note: POST /login does NOT block on the full OAuth flow. It kicks
 * the pi-ai flow off in the background and returns once the browser URL is
 * ready. The frontend opens the URL, then polls GET /status until the
 * session resolves.
 */

import { Router, type Request, type Response } from 'express';
import {
  startCodexLogin,
  getCodexAuthSnapshot,
  logoutCodex,
  submitManualCode,
  cancelLoginSession,
} from '../services/auth/codex-oauth.js';

const router = Router();

/**
 * Begin OAuth login. Returns the browser URL within ~5s, even if the
 * background flow hasn't completed (because it can't — the user hasn't
 * opened the URL yet).
 */
router.post('/auth/codex/login', async (_req: Request, res: Response) => {
  try {
    const snapshot = await startCodexLogin();
    if (!snapshot.url && snapshot.status !== 'awaiting_browser') {
      res.status(500).json({
        error: 'Failed to start OAuth flow',
        details: snapshot.error ?? 'No URL was generated',
      });
      return;
    }
    res.json({
      url: snapshot.url ?? null,
      status: snapshot.status,
      startedAt: snapshot.startedAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[codex-auth route] /login error:', message);
    res.status(500).json({ error: 'Failed to start Codex login', details: message });
  }
});

/**
 * Snapshot of current auth state. Safe to poll — non-throwing, only does a
 * small file read. Frontend polls this every ~2s while a login is in
 * `awaiting_browser` to detect completion.
 */
router.get('/auth/codex/status', async (_req: Request, res: Response) => {
  try {
    const snapshot = await getCodexAuthSnapshot();
    res.json(snapshot);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[codex-auth route] /status error:', message);
    res.status(500).json({ error: 'Failed to read Codex auth status', details: message });
  }
});

/**
 * Submit a manually-pasted OAuth code. Use this when the browser callback
 * doesn't work (e.g. headless or remote deployments — see Phase 2 plan R4).
 * The code races with the local-server callback inside pi-ai; whichever
 * completes first wins.
 */
router.post('/auth/codex/manual-code', (req: Request, res: Response) => {
  const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
  if (!code) {
    res.status(400).json({ error: 'Field `code` is required (non-empty string)' });
    return;
  }
  const accepted = submitManualCode(code);
  if (!accepted) {
    res.status(409).json({
      error: 'No active Codex login is waiting for a manual code',
    });
    return;
  }
  res.json({ success: true });
});

/**
 * Delete credentials + cancel any in-flight login. Idempotent — returns
 * success even if there was nothing to delete.
 */
router.post('/auth/codex/logout', async (_req: Request, res: Response) => {
  try {
    await logoutCodex();
    res.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[codex-auth route] /logout error:', message);
    res.status(500).json({ error: 'Failed to log out of Codex', details: message });
  }
});

/**
 * Cancel an in-flight login without deleting any existing credentials.
 * Useful for the frontend's "abandoned the popup" path.
 */
router.post('/auth/codex/cancel', (_req: Request, res: Response) => {
  cancelLoginSession();
  res.json({ success: true });
});

export default router;
