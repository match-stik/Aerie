// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// The phone's crash reports land here and go to the error log, tagged
// [client-error], one line each. Read them in the backend's error output
// (pm2's error log, when the house runs under pm2).

import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { clientErrorLine } from '../services/client-errors.js';

const router = Router();
router.use(authMiddleware);

router.post('/', (req, res) => {
  const line = clientErrorLine(req.body);
  if (!line) {
    res.status(400).json({ error: 'Nothing to report' });
    return;
  }
  console.error(`[client-error] ${line}`);
  res.json({ success: true });
});

export default router;
