// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Sticker API routes
import { Router } from 'express';
import * as nodeFs from 'fs';
import * as nodePath from 'path';
import * as stickerFiles from '../services/sticker-admin.js';
import { cropEveryFrame, cropBoxFrom } from '../services/animated-crop.js';
import multer from 'multer';
import crypto from 'crypto';
import { authMiddleware } from '../middleware/auth.js';
import {
  createStickerPack,
  getStickerPack,
  getStickerPackByName,
  listStickerPacks,
  updateStickerPack,
  deleteStickerPack,
  createSticker,
  getSticker,
  listStickers,
  updateSticker,
  deleteSticker,
  getPacksWithStickers,
  getStickerByRef,
} from '../services/db/stickers.js';
import {
  writeStickerFile,
  deleteStickerFile,
  deleteStickerPackFiles,
  stickerFilenameFor,
} from '../services/sticker-admin.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB max — animated transparents need room
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/png', 'image/webp', 'image/gif'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PNG, WebP, and GIF files are allowed'));
    }
  },
});

// Wrap multer so its errors surface as 4xx with a useful body instead of
// bubbling to the global 500 handler.
function uploadWithErrors(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large (max 2MB).' });
      }
      return res.status(400).json({ error: err.message });
    }
    return res.status(400).json({ error: err.message || 'Upload failed' });
  });
}

// All routes require auth
router.use(authMiddleware);

// === Pack routes ===

// List all packs
router.get('/packs', (_req, res) => {
  const packs = listStickerPacks();
  res.json(packs);
});

// Create pack
router.post('/packs', (req, res) => {
  const { name, description, userOnly } = req.body;
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Name is required' });
  }

  const existing = getStickerPackByName(name);
  if (existing) {
    return res.status(409).json({ error: 'Pack with this name already exists' });
  }

  const pack = createStickerPack({
    id: crypto.randomUUID(),
    name: name.toLowerCase().replace(/[^a-z0-9]/g, ''),
    description,
    userOnly: Boolean(userOnly),
    createdAt: new Date().toISOString(),
  });

  res.status(201).json(pack);
});

// Update pack
router.put('/packs/:id', (req, res) => {
  const { id } = req.params;
  const { name, description, userOnly } = req.body;

  const pack = getStickerPack(id);
  if (!pack) {
    return res.status(404).json({ error: 'Pack not found' });
  }

  if (name && name !== pack.name) {
    const existing = getStickerPackByName(name);
    if (existing) {
      return res.status(409).json({ error: 'Pack with this name already exists' });
    }
  }

  updateStickerPack(id, {
    name: name ? name.toLowerCase().replace(/[^a-z0-9]/g, '') : undefined,
    description,
    userOnly,
  });

  res.json(getStickerPack(id));
});

// Delete pack
router.delete('/packs/:id', (req, res) => {
  const { id } = req.params;

  const pack = getStickerPack(id);
  if (!pack) {
    return res.status(404).json({ error: 'Pack not found' });
  }

  deleteStickerPackFiles(id);
  deleteStickerPack(id);

  res.status(204).send();
});

// === Sticker routes ===

// List stickers (optionally by pack)
router.get('/', (req, res) => {
  const { packId } = req.query;
  const stickers = listStickers(packId as string | undefined);
  res.json(stickers);
});

// Get packs with stickers (for picker UI)
router.get('/packs-with-stickers', (_req, res) => {
  const packs = getPacksWithStickers();
  res.json(packs);
});

// Lookup sticker by pack and name (for shortcode resolution)
router.get('/lookup', (req, res) => {
  const { pack, name } = req.query;
  if (!pack || !name || typeof pack !== 'string' || typeof name !== 'string') {
    return res.status(400).json({ error: 'pack and name query params required' });
  }
  const sticker = getStickerByRef(pack, name);
  if (!sticker) {
    return res.status(404).json({ error: 'Sticker not found' });
  }
  res.json(sticker);
});

// Upload sticker. Filenames — and the version token every one of them carries
// — are the file layer's business: see stickerFilenameFor in sticker-admin.
router.post('/', uploadWithErrors, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { packId, name, aliases } = req.body;
    if (!packId || !name) {
      return res.status(400).json({ error: 'packId and name are required' });
    }

    const pack = getStickerPack(packId);
    if (!pack) {
      return res.status(404).json({ error: 'Pack not found' });
    }

    // An animated picture framed in the upload table arrives with its box beside it,
    // and is cut here, every frame, before anything is saved.
    let bytes: Buffer = req.file.buffer;
    let mimetype: string = req.file.mimetype;
    const box = cropBoxFrom(req.body);
    if (box) {
      const cropped = await cropEveryFrame(bytes, box, 256);
      bytes = cropped.out;
      mimetype = cropped.mime;
    }

    const savedFilename = stickerFilenameFor(name, mimetype);

    let parsedAliases: string[] = [];
    if (aliases) {
      try {
        parsedAliases = typeof aliases === 'string' ? JSON.parse(aliases) : aliases;
      } catch {
        parsedAliases = [];
      }
    }

    // The row goes in FIRST. This used to write the file up front, so a
    // duplicate name — which throws UNIQUE below — had already put its bytes
    // on disk: same extension silently overwrote the live picture behind an
    // error message, a different one dropped an orphan beside it while the row
    // went on pointing at the original. Insert, then write, so a rejected
    // upload touches nothing.
    const sticker = createSticker({
      id: crypto.randomUUID(),
      packId,
      name: name.toLowerCase().replace(/[^a-z0-9_]/g, ''),
      filename: savedFilename,
      aliases: parsedAliases,
      createdAt: new Date().toISOString(),
    });
    writeStickerFile(packId, savedFilename, bytes);

    res.status(201).json(sticker);
  } catch (err) {
    // SQLITE_CONSTRAINT_UNIQUE on (pack_id, name) is the common case —
    // re-uploading a sticker that already exists in the pack.
    const message = err instanceof Error ? err.message : String(err);
    if (/UNIQUE/.test(message)) {
      return res.status(409).json({ error: 'A sticker with this name already exists in the pack.' });
    }
    console.error('[Stickers] Upload failed:', err);
    res.status(500).json({ error: message });
  }
});

// Update sticker (PUT and PATCH both work)
function handleStickerUpdate(req: any, res: any) {
  const { id } = req.params;
  const { name } = req.body;
  let { aliases } = req.body;

  const sticker = getSticker(id);
  if (!sticker) {
    return res.status(404).json({ error: 'Sticker not found' });
  }

  // Multipart sends every field as a string; JSON renames still arrive parsed.
  if (typeof aliases === 'string') {
    try { aliases = JSON.parse(aliases); } catch { aliases = undefined; }
  }

  const cleanName = name ? name.toLowerCase().replace(/[^a-z0-9_]/g, '') : undefined;

  // Replacing the PICTURE of a sticker that already exists had no road at all:
  // upload creates a new row and refuses a name the pack already holds, and
  // this route could not receive a file. So a corrected drawing could only be
  // added under a different name, and the original stayed on screen forever.
  const newFilename = req.file
    ? stickerFilenameFor(cleanName ?? sticker.name, req.file.mimetype)
    : undefined;

  try {
    updateSticker(id, { name: cleanName, aliases, filename: newFilename });
  } catch (err) {
    // A pack cannot hold two stickers of the same name, and renaming onto one
    // that already exists is the COMMON case here — this screen's whole job is
    // fixing typos, and a typo's correct spelling is often already taken by
    // the sticker that prompted the fix. Sqlite threw the constraint straight
    // past the handler, Express turned it into a bare 500, and the owner got
    // "internal server error" with no name in it and no idea which of eighty
    // renames had failed.
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({
        error: `This pack already has a sticker called "${cleanName}"`,
      });
    }
    throw err;
  }

  // Row first, bytes second — a rejected rename must not leave a file behind.
  if (req.file && newFilename) {
    writeStickerFile(sticker.pack_id, newFilename, req.file.buffer);
    if (sticker.filename !== newFilename) {
      deleteStickerFile(sticker.pack_id, sticker.filename);
    }
  }

  res.json(getSticker(id));
}

// Crop a sticker where it already lives, every frame of it. The phone crops a still
// on a canvas, but a canvas keeps one frame, so an animated sticker is framed on the
// phone and cut here instead, frame by frame, keeping its timing and its loop.
// sharp is imported lazily so a broken sharp costs this one door, not every sticker.
router.post('/:id/crop', async (req, res) => {
  const sticker = getSticker(req.params.id);
  if (!sticker) return res.status(404).json({ error: 'Sticker not found' });
  const nums = ['x', 'y', 'width', 'height'].map((k) => Number(req.body?.[k]));
  if (nums.some((n) => !Number.isFinite(n)) || nums[2] < 1 || nums[3] < 1) {
    return res.status(400).json({ error: 'x, y, width and height are required' });
  }
  try {
    const src = nodeFs.readFileSync(nodePath.join(stickerFiles.getStickersDir(), sticker.pack_id, sticker.filename));
    const { out, mime } = await cropEveryFrame(src, { x: nums[0], y: nums[1], width: nums[2], height: nums[3] }, 256);
    const newFilename = stickerFiles.stickerFilenameFor(sticker.name, mime);
    // Bytes first this time: no rename can be refused here, and a row pointing at a
    // file that was never written is the one outcome worse than doing nothing.
    stickerFiles.writeStickerFile(sticker.pack_id, newFilename, out);
    updateSticker(sticker.id, { filename: newFilename });
    if (sticker.filename !== newFilename) stickerFiles.deleteStickerFile(sticker.pack_id, sticker.filename);
    res.json(getSticker(sticker.id));
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Crop failed' });
  }
});

router.put('/:id', uploadWithErrors, handleStickerUpdate);
router.patch('/:id', uploadWithErrors, handleStickerUpdate);

// Delete sticker
router.delete('/:id', (req, res) => {
  const { id } = req.params;

  const sticker = getSticker(id);
  if (!sticker) {
    return res.status(404).json({ error: 'Sticker not found' });
  }

  deleteStickerFile(sticker.pack_id, sticker.filename);
  deleteSticker(id);

  res.status(204).send();
});

export default router;
