// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// routes/memory-blocks.ts — Memory Blocks API routes (companion-scoped)
import { Router } from 'express';
import * as memoryBlocks from '../services/memory-blocks.js';
import { findNeighbors } from '../services/memory-neighbors.js';
import { getMemoryExtractionStatus, runMemoryExtraction } from '../services/memory-extraction.js';
import type { AgentService } from '../services/agent.js';

const router = Router();

function checkScope(raw: string, res: { status: (n: number) => { json: (o: unknown) => unknown } }): string | null {
  const scope = memoryBlocks.resolveScope(raw);
  if (!scope) {
    res.status(400).json({ error: `Unknown scope '${raw}'. Valid scopes: ${memoryBlocks.validScopesHint()}` });
    return null;
  }
  return scope;
}

router.get('/memory/blocks', (req, res) => {
  const scopeFilter = req.query.scope as string | undefined;
  let blocks = memoryBlocks.getAllBlocks();
  if (scopeFilter) blocks = blocks.filter(b => b.scope === scopeFilter);
  res.json(blocks);
});

router.get('/memory/blocks/:scope/:label', (req, res) => {
  const block = memoryBlocks.getBlock(req.params.scope, req.params.label);
  if (!block) return res.status(404).json({ error: 'Block not found' });
  res.json(block);
});

router.get('/memory/extraction/status', (_req, res) => {
  res.json(getMemoryExtractionStatus());
});

router.post('/memory/blocks', (req, res) => {
  const { scope: rawScope, label, content, description } = req.body;
  if (!label) return res.status(400).json({ error: 'Label required' });
  const scope = checkScope(rawScope || memoryBlocks.SHARED_SCOPE, res);
  if (!scope) return;
  memoryBlocks.setBlock(scope, label, content || '', description);
  res.json({ success: true });
});

router.put('/memory/blocks/:scope/:label', (req, res) => {
  const scope = checkScope(req.params.scope, res);
  if (!scope) return;
  const { content, description } = req.body;
  memoryBlocks.setBlock(scope, req.params.label, content || '', description);
  res.json({ success: true });
});

router.delete('/memory/blocks/:scope/:label', (req, res) => {
  memoryBlocks.deleteBlock(req.params.scope, req.params.label);
  res.json({ success: true });
});

router.post('/memory/blocks/:scope/:label/append', async (req, res) => {
  try {
    const scope = checkScope(req.params.scope, res);
    if (!scope) return;
    const { content } = req.body;
    // Look BEFORE the write, so what comes back describes the wall the line was
    // added to rather than the wall containing it. Never blocks the write:
    // a wall that grows is better than one that refuses.
    let neighbors: Awaited<ReturnType<typeof findNeighbors>> | null = null;
    try {
      neighbors = await findNeighbors(scope, String(content ?? ''));
    } catch {
      neighbors = null;
    }
    const result = memoryBlocks.appendToBlock(scope, req.params.label, content);
    res.json({ success: true, content: result, neighbors });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// The same check without writing anything — for looking first.
router.post('/memory/blocks/:scope/:label/neighbors', async (req, res) => {
  try {
    const scope = checkScope(req.params.scope, res);
    if (!scope) return;
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'content is required' });
    res.json({ success: true, ...(await findNeighbors(scope, String(content))) });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.post('/memory/blocks/:scope/:label/replace', (req, res) => {
  try {
    const scope = checkScope(req.params.scope, res);
    if (!scope) return;
    const { oldText, newText } = req.body;
    const result = memoryBlocks.replaceInBlock(scope, req.params.label, oldText, newText);
    res.json({ success: true, content: result });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.post('/memory/blocks/:scope/:label/rethink', (req, res) => {
  try {
    const scope = checkScope(req.params.scope, res);
    if (!scope) return;
    const { content } = req.body;
    const result = memoryBlocks.rethinkBlock(scope, req.params.label, content);
    res.json({ success: true, content: result });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Manually trigger the Archivist — whole sweep, or one thread via { threadId }
router.post('/memory/extract', async (req, res) => {
  try {
    const { threadId } = req.body || {};
    const agent = req.app.locals.agentService as AgentService | undefined;
    const result = await runMemoryExtraction(agent, threadId);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
