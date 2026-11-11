// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { Router } from 'express';
import { fileIdsInUse } from '../../services/file-references.js';
import multer from 'multer';
import { basename } from 'path';
import { getDb } from '../../services/db.js';
import { saveFile, deleteFile, listFiles } from '../../services/files.js';
import rateLimit from 'express-rate-limit';

const router = Router();

// --- File upload/download ---

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

const uploadRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Too many uploads, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
});

// File upload
router.post('/files', uploadRateLimiter, upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file provided' });
      return;
    }

    // Security: sanitize filename (basename + character filter + length cap)
    const rawName = req.file.originalname || 'unnamed';
    const safeName = basename(rawName).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 255);
    const fileMeta = saveFile(req.file.buffer, safeName, req.file.mimetype);
    res.json(fileMeta);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Upload failed';
    console.error('File upload error:', msg);
    res.status(400).json({ error: msg });
  }
});


// Bulk delete: drop every file not referenced by any message's metadata or content.
// Anything fileIdsInUse() does not name gets deleted, the same list the
// Files app's in-use badges read.
router.post('/files/clean-orphans', (req, res) => {
  try {
    const files = listFiles();
    const db = getDb();
    const usedFileIds = fileIdsInUse(db);

    let deleted = 0;
    for (const f of files) {
      if (!usedFileIds.has(f.fileId)) {
        if (deleteFile(f.fileId)) deleted++;
      }
    }
    res.json({ success: true, deleted });
  } catch (err) {
    console.error('Error cleaning orphan files:', err);
    res.status(500).json({ error: 'Failed to clean orphans' });
  }
});

// Bulk delete a list of file ids in one request.
router.post('/files/bulk-delete', (req, res) => {
  try {
    const ids = (req.body as { ids?: string[] }).ids;
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'ids[] required' });
      return;
    }
    let deleted = 0;
    for (const id of ids) {
      if (typeof id === 'string' && deleteFile(id)) deleted++;
    }
    res.json({ success: true, deleted });
  } catch (err) {
    console.error('Error bulk-deleting files:', err);
    res.status(500).json({ error: 'Failed to bulk delete' });
  }
});

// Delete a file
router.delete('/files/:id', (req, res) => {
  try {
    const deleted = deleteFile(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

export default router;
