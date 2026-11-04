// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { Router } from 'express';
import crypto from 'crypto';
import * as babel from '@babel/core';
import { getDb } from '../../services/db.js';

const router = Router();

// ─── Artifacts (interactive React components) ────────────────────
router.get('/artifacts', (req, res) => {
  try {
    const db = getDb();
    const artifacts = db.prepare(`
      SELECT id, name, description, thumbnail, created_at, updated_at
      FROM artifacts
      ORDER BY updated_at DESC
    `).all();
    res.json({ artifacts });
  } catch (err) {
    console.error('[Artifacts] List error:', err);
    res.status(500).json({ error: 'Failed to list artifacts' });
  }
});

router.get('/artifacts/:id', (req, res) => {
  try {
    const db = getDb();
    const artifact = db.prepare(`SELECT * FROM artifacts WHERE id = ?`).get(req.params.id);
    if (!artifact) {
      return res.status(404).json({ error: 'Artifact not found' });
    }
    res.json({ artifact });
  } catch (err) {
    console.error('[Artifacts] Get error:', err);
    res.status(500).json({ error: 'Failed to get artifact' });
  }
});

router.post('/artifacts', async (req, res) => {
  try {
    const { name, description, code, thumbnail } = req.body;
    if (!name || !code) {
      return res.status(400).json({ error: 'name and code are required' });
    }

    // Pre-compile JSX to plain JavaScript
    let compiledCode = code;
    try {
      const result = await babel.transformAsync(code, {
        presets: ['@babel/preset-react'],
        filename: 'artifact.jsx',
      });
      if (result?.code) {
        compiledCode = result.code;
        console.log('[Artifacts] Compiled JSX successfully');
      }
    } catch (compileErr: any) {
      console.warn('[Artifacts] JSX compilation failed, storing raw code:', compileErr.message);
      // Store raw code if compilation fails — might be plain JS already
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const db = getDb();
    db.prepare(`
      INSERT INTO artifacts (id, name, description, code, thumbnail, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, description || null, compiledCode, thumbnail || null, now, now);
    const artifact = db.prepare(`SELECT * FROM artifacts WHERE id = ?`).get(id);
    res.status(201).json({ artifact });
  } catch (err) {
    console.error('[Artifacts] Create error:', err);
    res.status(500).json({ error: 'Failed to create artifact' });
  }
});

router.patch('/artifacts/:id', (req, res) => {
  try {
    const db = getDb();
    const existing = db.prepare(`SELECT * FROM artifacts WHERE id = ?`).get(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Artifact not found' });
    }
    const { name, description, code, thumbnail } = req.body;
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE artifacts SET
        name = COALESCE(?, name),
        description = COALESCE(?, description),
        code = COALESCE(?, code),
        thumbnail = COALESCE(?, thumbnail),
        updated_at = ?
      WHERE id = ?
    `).run(name, description, code, thumbnail, now, req.params.id);
    const artifact = db.prepare(`SELECT * FROM artifacts WHERE id = ?`).get(req.params.id);
    res.json({ artifact });
  } catch (err) {
    console.error('[Artifacts] Update error:', err);
    res.status(500).json({ error: 'Failed to update artifact' });
  }
});

router.delete('/artifacts/:id', (req, res) => {
  try {
    const db = getDb();
    const existing = db.prepare(`SELECT * FROM artifacts WHERE id = ?`).get(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Artifact not found' });
    }
    db.prepare(`DELETE FROM artifacts WHERE id = ?`).run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('[Artifacts] Delete error:', err);
    res.status(500).json({ error: 'Failed to delete artifact' });
  }
});

export default router;
