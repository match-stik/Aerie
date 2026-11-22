// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// routes/memory-blocks.ts — Memory Blocks API routes (companion-scoped)
import { Router } from 'express';
import * as memoryBlocks from '../services/memory-blocks.js';
import { findNeighbors } from '../services/memory-neighbors.js';
import { getMemoryExtractionStatus, runMemoryExtraction } from '../services/memory-extraction.js';
import type { AgentService } from '../services/agent.js';
import multer from 'multer';
import { mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { PROJECT_ROOT, getAerieConfig } from '../config.js';
import { importConversations, parseExport, readExportFile, type ImportProgress } from '../services/conversation-import.js';
import { embed, vectorToBuffer } from '../services/embeddings.js';
import { saveConversation } from '../services/cortex.js';

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

// Old chats back word for word: a ChatGPT or Claude export (the zip as
// downloaded, or the conversations.json inside it) is read on this machine,
// cut into passages and added to the whisper's index, with each whole chat on
// Cortex's shelf. No model reads it and no key is needed. It runs in the
// background; the status route says how far along it is.
const UPLOAD_DIR = join(PROJECT_ROOT, 'data', 'uploads-tmp');
const exportUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => { mkdirSync(UPLOAD_DIR, { recursive: true }); cb(null, UPLOAD_DIR); },
    filename: (_req, _file, cb) => cb(null, `export-${Date.now()}`),
  }),
  limits: { fileSize: 1024 * 1024 * 1024 },
});

interface ConversationImportJob {
  state: 'reading' | 'importing' | 'done' | 'failed';
  file: string;
  startedAt: string;
  finishedAt: string | null;
  progress: ImportProgress | null;
  error: string | null;
}
let conversationJob: ConversationImportJob | null = null;

router.post('/memory/import/conversations', exportUpload.single('file'), (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file. Send the export zip, or the conversations.json inside it.' });
  // Only a file multer wrote into the upload folder is read or removed here.
  const filePath = resolve(file.path);
  if (!filePath.startsWith(resolve(UPLOAD_DIR) + sep)) return res.status(400).json({ error: 'That upload did not land where uploads go.' });
  if (conversationJob && (conversationJob.state === 'reading' || conversationJob.state === 'importing')) {
    try { unlinkSync(filePath); } catch { /* already gone */ }
    return res.status(409).json({ error: 'An import is already running.', job: conversationJob });
  }
  const job: ConversationImportJob = { state: 'reading', file: file.originalname, startedAt: new Date().toISOString(), finishedAt: null, progress: null, error: null };
  conversationJob = job;
  res.json({ job });
  void (async () => {
    // Checked again here: the check above does not follow into this later
    // step, and the read and the removal below both use the path.
    const uploaded = resolve(filePath);
    if (!uploaded.startsWith(resolve(UPLOAD_DIR) + sep)) { job.state = 'failed'; job.error = 'That upload did not land where uploads go.'; job.finishedAt = new Date().toISOString(); return; }
    try {
      const person = String(req.body?.person || getAerieConfig().identity?.user_name || 'You');
      // Read inside its own step, so the file's bytes and its text can be let
      // go before the long import starts (a big export is several copies of
      // itself in memory at this point).
      const convs = (() => {
        const bytes = readFileSync(uploaded);
        return parseExport(readExportFile(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), file.originalname), { person });
      })();
      job.state = 'importing';
      job.progress = { conversations: convs.length, done: 0, skipped: 0, passages: 0, shelved: 0 };
      job.progress = await importConversations(convs, {
        embed, vectorToBuffer,
        shelve: async (title, content, summary) => {
          const out = await saveConversation(title, content, 'archive', summary);
          return /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(String(out))?.[1] ?? null;
        },
        onProgress: (p) => { job.progress = p; },
      });
      job.state = 'done';
    } catch (err) {
      job.state = 'failed';
      job.error = err instanceof Error ? err.message : String(err);
      console.warn(`[conversation-import] ${job.error}`);
    } finally {
      job.finishedAt = new Date().toISOString();
      try { unlinkSync(uploaded); } catch { /* already gone */ }
    }
  })();
});

router.get('/memory/import/conversations/status', (_req, res) => {
  res.json({ job: conversationJob });
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
