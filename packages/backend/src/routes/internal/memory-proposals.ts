// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { Router } from 'express';
import { listProposals, getProposal, resolveProposal, countPending } from '../../services/memory-proposals.js';
import { resolve } from 'path';

const router = Router();

// --- Memory proposals (the Archivist's noticings) -------------------------
// The Archivist hands its findings to the companions instead of writing them
// onto the blocks. These endpoints let a companion see what is waiting and
// close one out after deciding — filed (they wrote it in their own words) or
// dropped (it does not belong on the wall).

router.get('/internal/memory-proposals', (req, res) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : 'pending';
    const rows = status === 'all'
      ? listProposals(undefined, 100)
      : listProposals(status as 'pending' | 'filed' | 'dropped' | 'faded', 100);
    res.json({ success: true, proposals: rows, pending: countPending() });
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

router.post('/internal/memory-proposals/:id/resolve', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: 'bad id' });

    const status = req.body?.status;
    if (status !== 'filed' && status !== 'dropped') {
      return res.status(400).json({ success: false, error: 'status must be "filed" or "dropped"' });
    }
    const by = typeof req.body?.by === 'string' && req.body.by.trim() ? req.body.by.trim() : 'companion';

    const proposal = getProposal(id);
    if (!proposal) return res.status(404).json({ success: false, error: 'no such proposal' });

    const changed = resolveProposal(id, status, by);
    if (!changed) {
      return res.json({ success: true, alreadyResolved: true, proposal: getProposal(id) });
    }
    res.json({ success: true, proposal: getProposal(id) });
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
