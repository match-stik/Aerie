// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// routes/cortex.ts — Cortex API routes
import { Router } from 'express';
import * as cortex from '../services/cortex.js';
import {
  extractMemoryId, findNearDuplicates, recordFeedback, setTemporalValidity, supersedeMemory,
} from '../services/cortex-memory-quality.js';
import { listMemoryLedger, markMemoryLedgerSeen } from '../services/memory-ledger.js';
import { runMemoryRounds } from '../services/memory-rounds.js';

const router = Router();

router.get('/cortex/health', async (req, res) => {
  const online = await cortex.ping();
  res.json({ online });
});

router.get('/cortex/ledger', (req, res) => {
  const limit = Number(req.query.limit) || 100;
  const offset = Number(req.query.offset) || 0;
  res.json({ entries: listMemoryLedger(limit, offset) });
});

router.post('/cortex/ledger/seen', (req, res) => {
  markMemoryLedgerSeen(Number(req.body.throughId) || 0);
  res.json({ success: true });
});

router.post('/cortex/rounds', async (_req, res) => {
  try { res.json({ success: true, summary: await runMemoryRounds(true) }); }
  catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.get('/cortex/stats', async (req, res) => {
  try {
    const stats = await cortex.brainStats();
    res.json(JSON.parse(stats));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/cortex/tunnel/:domain', async (req, res) => {
  try {
    const state = await cortex.tunnelState(req.params.domain);
    res.json(JSON.parse(state));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/cortex/context/:domain', async (req, res) => {
  try {
    const ctx = await cortex.contextRecovery(req.params.domain);
    res.json(JSON.parse(ctx));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// List all memories (direct HTTP API — raw SQL, not semantic search)
router.get('/cortex/memories', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 500;
    const offset = parseInt(req.query.offset as string) || 0;
    const result = await cortex.listAllMemories(limit, offset);
    res.json({ results: result.results, total: result.total });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// List all memories in a domain (direct HTTP API — raw SQL, not semantic search)
router.get('/cortex/domain/:domain/memories', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 500;
    const offset = parseInt(req.query.offset as string) || 0;
    const result = await cortex.listDomainMemories(req.params.domain, limit, offset);
    // Return full response with total for pagination
    res.json({ results: result.results, total: result.total });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/cortex/remember', async (req, res) => {
  try {
    const { content, domain } = req.body;
    if (typeof content !== 'string' || !content.trim()) {
      res.status(400).json({ error: 'content is required' });
      return;
    }
    const warnings = await findNearDuplicates(content, domain);
    const result = await cortex.rememberThought(content, domain);
    res.json({ success: true, result, memoryId: extractMemoryId(result), warnings });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.patch('/cortex/memory/:id/validity', (req, res) => {
  const { validFrom, validUntil } = req.body;
  setTemporalValidity(req.params.id, validFrom, validUntil);
  res.json({ success: true });
});

router.post('/cortex/memory/:id/feedback', async (req, res) => {
  try {
    const { kind, correction, domain, supersededBy } = req.body as {
      kind?: 'confirm' | 'correct'; correction?: string; domain?: string; supersededBy?: string;
    };
    if (kind !== 'confirm' && kind !== 'correct') {
      res.status(400).json({ error: 'kind must be confirm or correct' });
      return;
    }
    recordFeedback(req.params.id, kind);
    let replacementId = supersededBy || null;
    let result: string | null = null;
    let warnings: Awaited<ReturnType<typeof findNearDuplicates>> = [];
    if (kind === 'correct' && correction?.trim()) {
      warnings = await findNearDuplicates(correction, domain);
      result = await cortex.rememberThought(correction, domain);
      replacementId = extractMemoryId(result);
    }
    if (replacementId) supersedeMemory(req.params.id, replacementId);
    res.json({ success: true, replacementId, result, warnings });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/cortex/search', async (req, res) => {
  try {
    const { q, domain, type = 'unified', limit } = req.query as Record<string, string>;
    const limitNum = limit ? parseInt(limit, 10) : undefined;
    let result: string;
    if (type === 'memories') {
      result = await cortex.recallMemories(q, domain, limitNum);
    } else if (type === 'conversations') {
      result = await cortex.searchConversations(q, domain, limitNum);
    } else {
      result = await cortex.unifiedSearch(q, limitNum);
    }
    res.json(JSON.parse(result));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/cortex/open-threads', async (req, res) => {
  try {
    const { domain } = req.query as Record<string, string>;
    const threads = await cortex.openThreads(domain);
    res.json(JSON.parse(threads));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/cortex/patterns', async (req, res) => {
  try {
    const patterns = await cortex.cognitivePatterns();
    res.json(JSON.parse(patterns));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/cortex/principles', async (req, res) => {
  try {
    const { domain } = req.query as Record<string, string>;
    const principles = await cortex.listPrinciples(domain);
    res.json(JSON.parse(principles));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/cortex/principle', async (req, res) => {
  try {
    const { name, content, domain } = req.body;
    const result = await cortex.savePrinciple(name, content, domain);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/cortex/conversation', async (req, res) => {
  try {
    const { title, content, domain, summary } = req.body;
    const result = await cortex.saveConversation(title, content, domain, summary);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Memory management routes (edit/delete)
router.delete('/cortex/memory/:id', async (req, res) => {
  try {
    const result = await cortex.deleteVaultEntry(req.params.id);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.patch('/cortex/memory/:id', async (req, res) => {
  try {
    const { content, domain } = req.body;
    const result = await cortex.editVaultEntry(req.params.id, content, domain);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
