// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Identity & memory file routes — view and edit CLAUDE.md and the warm
// lane's persistent memory files. Served in the phone's Agent > Identity tab.
//
// History: this started as the SDK-era X-Ray panel. The wake-prompt view
// moved to /orchestrator/wake-prompts (effective live prompts, not a raw
// file dump), the context tab described a retired injection design, and the
// hooks tab duplicated the trigger panel — all removed with the X-Ray app.

import { Router } from 'express';
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..', '..');

// The warm Claude lane's auto-memory lives under the Claude Code project
// directory for the repo root (every non-alphanumeric path character
// becomes a dash — including underscores), not under a .claude/memory
// folder in the repo — that directory never existed.
const MEMORY_DIR = join(
  homedir(),
  '.claude',
  'projects',
  PROJECT_ROOT.replace(/[^a-zA-Z0-9-]/g, '-'),
  'memory',
);

const router = Router();

// GET /xray/identity — read CLAUDE.md
router.get('/xray/identity', async (_req, res) => {
  try {
    const claudeMdPath = resolve(PROJECT_ROOT, 'CLAUDE.md');
    if (!existsSync(claudeMdPath)) {
      res.json({ content: null, error: 'CLAUDE.md not found', path: claudeMdPath });
      return;
    }
    const content = readFileSync(claudeMdPath, 'utf-8');
    res.json({ content, path: claudeMdPath });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /xray/identity — update CLAUDE.md
router.put('/xray/identity', async (req, res) => {
  try {
    const { content } = req.body;
    if (typeof content !== 'string') {
      res.status(400).json({ error: 'content required' });
      return;
    }
    const claudeMdPath = resolve(PROJECT_ROOT, 'CLAUDE.md');
    if (existsSync(claudeMdPath)) {
      const backup = readFileSync(claudeMdPath, 'utf-8');
      const backupPath = claudeMdPath + '.backup';
      writeFileSync(backupPath, backup, 'utf-8');
    }
    writeFileSync(claudeMdPath, content, 'utf-8');
    res.json({ success: true, path: claudeMdPath });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /xray/memory — read MEMORY.md index and all memory files
router.get('/xray/memory', async (_req, res) => {
  try {
    const memoryMdPath = join(MEMORY_DIR, 'MEMORY.md');

    let index: string | null = null;
    const files: Array<{ name: string; path: string; content: string }> = [];

    if (existsSync(memoryMdPath)) {
      index = readFileSync(memoryMdPath, 'utf-8');
    }

    if (existsSync(MEMORY_DIR)) {
      const entries = readdirSync(MEMORY_DIR);
      for (const entry of entries) {
        if (entry.endsWith('.md') && entry !== 'MEMORY.md') {
          const filePath = join(MEMORY_DIR, entry);
          const content = readFileSync(filePath, 'utf-8');
          files.push({ name: entry, path: filePath, content });
        }
      }
    }

    res.json({ index, files, memoryDir: MEMORY_DIR });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /xray/memory/:filename — update a memory file
router.put('/xray/memory/:filename', async (req, res) => {
  try {
    const { content } = req.body;
    const { filename } = req.params;
    if (typeof content !== 'string') {
      res.status(400).json({ error: 'content required' });
      return;
    }
    const filePath = join(MEMORY_DIR, filename);

    // Security: ensure we're staying within memory dir
    if (!filePath.startsWith(MEMORY_DIR)) {
      res.status(400).json({ error: 'Invalid path' });
      return;
    }

    if (existsSync(filePath)) {
      const backup = readFileSync(filePath, 'utf-8');
      writeFileSync(filePath + '.backup', backup, 'utf-8');
    }

    writeFileSync(filePath, content, 'utf-8');
    res.json({ success: true, path: filePath });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
