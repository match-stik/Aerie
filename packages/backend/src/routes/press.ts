// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import { Router } from 'express';
import crypto from 'crypto';
import multer from 'multer';
import { basename } from 'path';
import type {
  PressAsset,
  PressAssetKind,
  PressFormat,
  PressIssue,
  PressPack,
  PressPackItem,
  PressPackItemKind,
  PressPackSourceFormat,
  PressSpread,
} from '@aerie/shared';
import { authMiddleware } from '../middleware/auth.js';
import { getDb } from '../services/db.js';
import { getFile, saveFile, savePressSourceFile } from '../services/files.js';

const router = Router();
router.use(authMiddleware);
const pressSourceUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const pressItemUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const FORMATS = new Set<PressFormat>(['portrait', 'square', 'landscape', 'story', 'tall', 'wide', 'page', 'custom']);
const ASSET_KINDS = new Set<PressAssetKind>(['photo', 'border', 'tape', 'sticker', 'audio', 'other']);
const PACK_SOURCE_FORMATS = new Set<PressPackSourceFormat>(['images', 'zip', 'excalidrawlib']);
const PACK_ITEM_KINDS = new Set<PressPackItemKind>(['image', 'excalidraw']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SCENE_CHARS = 8 * 1024 * 1024;
const MAX_PACK_ITEMS = 500;
const MAX_LIBRARY_ITEM_CHARS = 512 * 1024;
const MAX_PACK_METADATA_CHARS = 128 * 1024;

// Defaults only. cleanDimension below lets any issue carry any size between 320 and
// 8192, and always has — these are the shortcuts, not the limits. 'custom' defaults
// to portrait so an issue created without numbers is still a usable page.
const FORMAT_DIMENSIONS: Record<PressFormat, { width: number; height: number }> = {
  portrait: { width: 1080, height: 1350 },
  square: { width: 1200, height: 1200 },
  landscape: { width: 1600, height: 900 },
  story: { width: 1080, height: 1920 },
  tall: { width: 1080, height: 1620 },
  wide: { width: 1620, height: 1080 },
  page: { width: 1275, height: 1650 },
  custom: { width: 1080, height: 1350 },
};

type IssueWithCount = PressIssue & { spread_count: number; cover_thumbnail_file_id: string | null };

function cleanText(value: unknown, max: number): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') return null;
  return value.trim().slice(0, max);
}

function cleanDimension(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(320, Math.min(8192, Math.round(parsed)));
}

function emptyScene(width: number, height: number): string {
  return JSON.stringify({
    version: 1,
    page: { x: 0, y: 0, width, height, background: '#fffaf0' },
    elements: [],
    appState: { viewBackgroundColor: '#09090b' },
    files: {},
  });
}

function issueById(id: string): IssueWithCount | undefined {
  return getDb().prepare(`
    SELECT i.*, COUNT(s.id) AS spread_count,
      COALESCE(
        (SELECT c.thumbnail_file_id FROM press_spreads c WHERE c.id = i.cover_spread_id),
        (SELECT f.thumbnail_file_id FROM press_spreads f
           WHERE f.issue_id = i.id AND f.thumbnail_file_id IS NOT NULL
           ORDER BY f.sort_order, f.created_at LIMIT 1)
      ) AS cover_thumbnail_file_id
    FROM press_issues i
    LEFT JOIN press_spreads s ON s.issue_id = i.id
    WHERE i.id = ?
    GROUP BY i.id
  `).get(id) as IssueWithCount | undefined;
}

function spreadById(id: string): PressSpread | undefined {
  return getDb().prepare('SELECT * FROM press_spreads WHERE id = ?').get(id) as PressSpread | undefined;
}

function assetById(id: string): PressAsset | undefined {
  return getDb().prepare('SELECT * FROM press_assets WHERE id = ?').get(id) as PressAsset | undefined;
}

function packById(id: string): PressPack | undefined {
  return getDb().prepare(`
    SELECT p.*, COUNT(i.id) AS item_count
    FROM press_packs p
    LEFT JOIN press_pack_items i ON i.pack_id = p.id
    WHERE p.id = ?
    GROUP BY p.id
  `).get(id) as PressPack | undefined;
}

function parseScene(value: unknown): string | null {
  let scene: string;
  if (typeof value === 'string') scene = value;
  else if (value && typeof value === 'object') scene = JSON.stringify(value);
  else return null;

  if (scene.length > MAX_SCENE_CHARS) return null;
  try {
    const parsed = JSON.parse(scene) as { version?: unknown; files?: unknown };
    if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) return null;
    // Generated materials may carry a tiny inline SVG. Imported photos must
    // remain file references, so cap every inline payload well below a photo.
    if (parsed.files && typeof parsed.files === 'object') {
      for (const ref of Object.values(parsed.files as Record<string, unknown>)) {
        if (!ref || typeof ref !== 'object') continue;
        const inline = (ref as { inlineDataURL?: unknown }).inlineDataURL;
        if (typeof inline === 'string' && inline.length > 128_000) return null;
      }
    }
    return scene;
  } catch {
    return null;
  }
}

router.post('/sources', pressSourceUpload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No Press source provided' });
      return;
    }
    const safeName = basename(req.file.originalname || 'brushes.abr')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 255);
    if (!safeName.toLowerCase().endsWith('.abr')) {
      res.status(400).json({ error: 'The Press source doorway currently accepts .abr files' });
      return;
    }
    res.json(savePressSourceFile(req.file.buffer, safeName));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Could not retain Press source' });
  }
});

router.post('/item-files', pressItemUpload.single('file'), (req, res) => {
  try {
    if (!req.file || !req.file.mimetype.startsWith('image/')) {
      res.status(400).json({ error: 'A Press pack item must be an image' });
      return;
    }
    const safeName = basename(req.file.originalname || 'press-item.png')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 255);
    res.json(saveFile(req.file.buffer, safeName, req.file.mimetype));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Could not retain Press pack item' });
  }
});

router.get('/issues', (_req, res) => {
  try {
    const issues = getDb().prepare(`
      SELECT i.*, COUNT(s.id) AS spread_count,
      COALESCE(
        (SELECT c.thumbnail_file_id FROM press_spreads c WHERE c.id = i.cover_spread_id),
        (SELECT f.thumbnail_file_id FROM press_spreads f
           WHERE f.issue_id = i.id AND f.thumbnail_file_id IS NOT NULL
           ORDER BY f.sort_order, f.created_at LIMIT 1)
      ) AS cover_thumbnail_file_id
      FROM press_issues i
      LEFT JOIN press_spreads s ON s.issue_id = i.id
      GROUP BY i.id
      ORDER BY i.updated_at DESC
    `).all() as IssueWithCount[];
    res.json({ issues });
  } catch (error) {
    console.error('[Press] List issues failed:', error);
    res.status(500).json({ error: 'Failed to list Press issues' });
  }
});

router.post('/issues', (req, res) => {
  try {
    const title = cleanText(req.body?.title, 160);
    if (!title) {
      res.status(400).json({ error: 'Issue title is required' });
      return;
    }
    const requestedFormat = req.body?.format as PressFormat | undefined;
    const format: PressFormat = requestedFormat && FORMATS.has(requestedFormat) ? requestedFormat : 'portrait';
    const defaults = FORMAT_DIMENSIONS[format];
    const width = cleanDimension(req.body?.pageWidth, defaults.width);
    const height = cleanDimension(req.body?.pageHeight, defaults.height);
    const subtitle = cleanText(req.body?.subtitle, 240);
    const now = new Date().toISOString();
    const issueId = crypto.randomUUID();
    const spreadId = crypto.randomUUID();
    const db = getDb();

    db.transaction(() => {
      db.prepare(`
        INSERT INTO press_issues
          (id, title, subtitle, format, page_width, page_height, cover_spread_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(issueId, title, subtitle || null, format, width, height, spreadId, now, now);
      db.prepare(`
        INSERT INTO press_spreads
          (id, issue_id, title, sort_order, scene_json, thumbnail_file_id, created_at, updated_at)
        VALUES (?, ?, 'Cover', 0, ?, NULL, ?, ?)
      `).run(spreadId, issueId, emptyScene(width, height), now, now);
    })();

    const issue = issueById(issueId)!;
    const spreads = [spreadById(spreadId)!];
    res.status(201).json({ issue, spreads });
  } catch (error) {
    console.error('[Press] Create issue failed:', error);
    // A bare 'Failed to create Press issue' is what the owner got for a week while
    // five of the eight page formats were being refused by a stale CHECK
    // constraint — the screen said something went wrong and named nothing, so
    // there was nothing to act on and no way to tell one cause from another.
    // Only the owner ever sees this string; it is their own house.
    const detail = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: `Failed to create Press issue — ${detail}` });
  }
});

router.get('/issues/:id', (req, res) => {
  try {
    const issue = issueById(req.params.id);
    if (!issue) {
      res.status(404).json({ error: 'Press issue not found' });
      return;
    }
    const spreads = getDb().prepare(`
      SELECT * FROM press_spreads WHERE issue_id = ? ORDER BY sort_order, created_at
    `).all(issue.id) as PressSpread[];
    const assets = getDb().prepare(`
      SELECT * FROM press_assets WHERE issue_id = ? ORDER BY created_at
    `).all(issue.id) as PressAsset[];
    res.json({ issue, spreads, assets });
  } catch (error) {
    console.error('[Press] Read issue failed:', error);
    res.status(500).json({ error: 'Failed to read Press issue' });
  }
});

router.patch('/issues/:id', (req, res) => {
  try {
    const issue = issueById(req.params.id);
    if (!issue) {
      res.status(404).json({ error: 'Press issue not found' });
      return;
    }

    const title = req.body?.title === undefined ? issue.title : cleanText(req.body.title, 160);
    if (!title) {
      res.status(400).json({ error: 'Issue title cannot be empty' });
      return;
    }
    const subtitle = req.body?.subtitle === undefined ? issue.subtitle : cleanText(req.body.subtitle, 240);
    const formatValue = req.body?.format as PressFormat | undefined;
    const format = formatValue && FORMATS.has(formatValue) ? formatValue : issue.format;
    const pageWidth = cleanDimension(req.body?.pageWidth, issue.page_width);
    const pageHeight = cleanDimension(req.body?.pageHeight, issue.page_height);
    const now = new Date().toISOString();

    getDb().prepare(`
      UPDATE press_issues
      SET title = ?, subtitle = ?, format = ?, page_width = ?, page_height = ?, updated_at = ?
      WHERE id = ?
    `).run(title, subtitle || null, format, pageWidth, pageHeight, now, issue.id);
    res.json({ issue: issueById(issue.id) });
  } catch (error) {
    console.error('[Press] Update issue failed:', error);
    res.status(500).json({ error: 'Failed to update Press issue' });
  }
});

router.delete('/issues/:id', (req, res) => {
  try {
    const issue = issueById(req.params.id);
    if (!issue) {
      res.status(404).json({ error: 'Press issue not found' });
      return;
    }
    const db = getDb();
    db.transaction(() => {
      db.prepare('DELETE FROM press_assets WHERE issue_id = ?').run(issue.id);
      db.prepare('DELETE FROM press_spreads WHERE issue_id = ?').run(issue.id);
      db.prepare('DELETE FROM press_issues WHERE id = ?').run(issue.id);
    })();
    res.json({ success: true });
  } catch (error) {
    console.error('[Press] Delete issue failed:', error);
    res.status(500).json({ error: 'Failed to delete Press issue' });
  }
});

router.post('/issues/:id/spreads', (req, res) => {
  try {
    const issue = issueById(req.params.id);
    if (!issue) {
      res.status(404).json({ error: 'Press issue not found' });
      return;
    }
    const db = getDb();
    const maxRow = db.prepare(`
      SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM press_spreads WHERE issue_id = ?
    `).get(issue.id) as { max_order: number };
    const sortOrder = Number(maxRow.max_order) + 1;
    const title = cleanText(req.body?.title, 160) || `Spread ${sortOrder + 1}`;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare(`
        INSERT INTO press_spreads
          (id, issue_id, title, sort_order, scene_json, thumbnail_file_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
      `).run(id, issue.id, title, sortOrder, emptyScene(issue.page_width, issue.page_height), now, now);
      db.prepare('UPDATE press_issues SET updated_at = ? WHERE id = ?').run(now, issue.id);
    })();
    res.status(201).json({ spread: spreadById(id) });
  } catch (error) {
    console.error('[Press] Create spread failed:', error);
    res.status(500).json({ error: 'Failed to create Press spread' });
  }
});

router.patch('/spreads/:id', (req, res) => {
  try {
    const spread = spreadById(req.params.id);
    if (!spread) {
      res.status(404).json({ error: 'Press spread not found' });
      return;
    }
    const title = req.body?.title === undefined ? spread.title : cleanText(req.body.title, 160);
    if (!title) {
      res.status(400).json({ error: 'Spread title cannot be empty' });
      return;
    }
    let sceneJson = spread.scene_json;
    if (req.body?.sceneJson !== undefined || req.body?.scene_json !== undefined) {
      const parsed = parseScene(req.body.sceneJson ?? req.body.scene_json);
      if (!parsed) {
        res.status(400).json({ error: 'Scene must be valid Press scene v1 JSON and under 8 MB' });
        return;
      }
      sceneJson = parsed;
    }
    const thumbnail = req.body?.thumbnailFileId === undefined
      ? spread.thumbnail_file_id
      : (typeof req.body.thumbnailFileId === 'string' && UUID_RE.test(req.body.thumbnailFileId)
        ? req.body.thumbnailFileId
        : null);
    const now = new Date().toISOString();
    const db = getDb();
    db.transaction(() => {
      db.prepare(`
        UPDATE press_spreads
        SET title = ?, scene_json = ?, thumbnail_file_id = ?, updated_at = ?
        WHERE id = ?
      `).run(title, sceneJson, thumbnail, now, spread.id);
      db.prepare('UPDATE press_issues SET updated_at = ? WHERE id = ?').run(now, spread.issue_id);
    })();
    res.json({ spread: spreadById(spread.id) });
  } catch (error) {
    console.error('[Press] Update spread failed:', error);
    res.status(500).json({ error: 'Failed to update Press spread' });
  }
});

router.delete('/spreads/:id', (req, res) => {
  try {
    const spread = spreadById(req.params.id);
    if (!spread) {
      res.status(404).json({ error: 'Press spread not found' });
      return;
    }
    const db = getDb();
    const count = db.prepare('SELECT COUNT(*) AS count FROM press_spreads WHERE issue_id = ?')
      .get(spread.issue_id) as { count: number };
    if (Number(count.count) <= 1) {
      res.status(409).json({ error: 'An issue must keep at least one spread' });
      return;
    }

    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare('DELETE FROM press_assets WHERE spread_id = ?').run(spread.id);
      db.prepare('DELETE FROM press_spreads WHERE id = ?').run(spread.id);
      const remaining = db.prepare(`
        SELECT id FROM press_spreads WHERE issue_id = ? ORDER BY sort_order, created_at
      `).all(spread.issue_id) as Array<{ id: string }>;
      const orderStmt = db.prepare('UPDATE press_spreads SET sort_order = ? WHERE id = ?');
      remaining.forEach((row, index) => orderStmt.run(index, row.id));
      const issue = db.prepare('SELECT cover_spread_id FROM press_issues WHERE id = ?')
        .get(spread.issue_id) as { cover_spread_id: string | null };
      const nextCover = issue.cover_spread_id === spread.id ? remaining[0]?.id || null : issue.cover_spread_id;
      db.prepare('UPDATE press_issues SET cover_spread_id = ?, updated_at = ? WHERE id = ?')
        .run(nextCover, now, spread.issue_id);
    })();
    res.json({ success: true });
  } catch (error) {
    console.error('[Press] Delete spread failed:', error);
    res.status(500).json({ error: 'Failed to delete Press spread' });
  }
});

router.put('/issues/:id/spreads/order', (req, res) => {
  try {
    const issue = issueById(req.params.id);
    if (!issue) {
      res.status(404).json({ error: 'Press issue not found' });
      return;
    }
    const requested = req.body?.spreadIds;
    if (!Array.isArray(requested) || requested.some((id) => typeof id !== 'string')) {
      res.status(400).json({ error: 'spreadIds[] is required' });
      return;
    }
    const existing = getDb().prepare('SELECT id FROM press_spreads WHERE issue_id = ?')
      .all(issue.id) as Array<{ id: string }>;
    const existingIds = new Set(existing.map((row) => row.id));
    const requestedIds = new Set(requested as string[]);
    if (requested.length !== existing.length || requestedIds.size !== existing.length
      || [...requestedIds].some((id) => !existingIds.has(id))) {
      res.status(400).json({ error: 'spreadIds must contain every spread exactly once' });
      return;
    }
    const now = new Date().toISOString();
    const db = getDb();
    db.transaction(() => {
      const stmt = db.prepare('UPDATE press_spreads SET sort_order = ?, updated_at = ? WHERE id = ?');
      (requested as string[]).forEach((id, index) => stmt.run(index, now, id));
      db.prepare('UPDATE press_issues SET updated_at = ? WHERE id = ?').run(now, issue.id);
    })();
    const spreads = db.prepare('SELECT * FROM press_spreads WHERE issue_id = ? ORDER BY sort_order')
      .all(issue.id) as PressSpread[];
    res.json({ spreads });
  } catch (error) {
    console.error('[Press] Reorder spreads failed:', error);
    res.status(500).json({ error: 'Failed to reorder Press spreads' });
  }
});

router.post('/assets', (req, res) => {
  try {
    const issue = issueById(req.body?.issueId);
    if (!issue) {
      res.status(404).json({ error: 'Press issue not found' });
      return;
    }
    const spreadId = typeof req.body?.spreadId === 'string' ? req.body.spreadId : null;
    if (spreadId) {
      const spread = spreadById(spreadId);
      if (!spread || spread.issue_id !== issue.id) {
        res.status(400).json({ error: 'Spread does not belong to this issue' });
        return;
      }
    }
    const sourceFileId = req.body?.sourceFileId;
    const renderedFileId = typeof req.body?.renderedFileId === 'string' ? req.body.renderedFileId : null;
    if (typeof sourceFileId !== 'string' || !UUID_RE.test(sourceFileId) || !getFile(sourceFileId)) {
      res.status(400).json({ error: 'A valid sourceFileId is required' });
      return;
    }
    if (renderedFileId && (!UUID_RE.test(renderedFileId) || !getFile(renderedFileId))) {
      res.status(400).json({ error: 'renderedFileId does not exist' });
      return;
    }
    const requestedKind = req.body?.kind as PressAssetKind | undefined;
    const kind: PressAssetKind = requestedKind && ASSET_KINDS.has(requestedKind) ? requestedKind : 'other';
    const recipe = req.body?.recipe && typeof req.body.recipe === 'object' ? req.body.recipe : {};
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    getDb().prepare(`
      INSERT INTO press_assets
        (id, issue_id, spread_id, name, kind, source_file_id, rendered_file_id, mime_type, recipe_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      issue.id,
      spreadId,
      cleanText(req.body?.name, 255),
      kind,
      sourceFileId,
      renderedFileId,
      typeof req.body?.mimeType === 'string' ? req.body.mimeType.slice(0, 120) : 'application/octet-stream',
      JSON.stringify(recipe),
      now,
      now,
    );
    res.status(201).json({ asset: assetById(id) });
  } catch (error) {
    console.error('[Press] Create asset failed:', error);
    res.status(500).json({ error: 'Failed to create Press asset' });
  }
});

router.patch('/assets/:id', (req, res) => {
  try {
    const asset = assetById(req.params.id);
    if (!asset) {
      res.status(404).json({ error: 'Press asset not found' });
      return;
    }
    let renderedFileId = asset.rendered_file_id;
    if (req.body?.renderedFileId !== undefined) {
      const candidate = req.body.renderedFileId;
      if (candidate !== null && (typeof candidate !== 'string' || !UUID_RE.test(candidate) || !getFile(candidate))) {
        res.status(400).json({ error: 'renderedFileId does not exist' });
        return;
      }
      renderedFileId = candidate;
    }
    const recipeJson = req.body?.recipe && typeof req.body.recipe === 'object'
      ? JSON.stringify(req.body.recipe)
      : asset.recipe_json;
    const now = new Date().toISOString();
    getDb().prepare(`
      UPDATE press_assets SET rendered_file_id = ?, recipe_json = ?, updated_at = ? WHERE id = ?
    `).run(renderedFileId, recipeJson, now, asset.id);
    res.json({ asset: assetById(asset.id) });
  } catch (error) {
    console.error('[Press] Update asset failed:', error);
    res.status(500).json({ error: 'Failed to update Press asset' });
  }
});

router.delete('/assets/:id', (req, res) => {
  try {
    const result = getDb().prepare('DELETE FROM press_assets WHERE id = ?').run(req.params.id);
    if (!result.changes) {
      res.status(404).json({ error: 'Press asset not found' });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    console.error('[Press] Delete asset failed:', error);
    res.status(500).json({ error: 'Failed to delete Press asset' });
  }
});

router.get('/packs', (_req, res) => {
  try {
    const packs = getDb().prepare(`
      SELECT p.*, COUNT(i.id) AS item_count
      FROM press_packs p
      LEFT JOIN press_pack_items i ON i.pack_id = p.id
      GROUP BY p.id
      ORDER BY p.updated_at DESC, p.name COLLATE NOCASE
    `).all() as PressPack[];
    const items = getDb().prepare(`
      SELECT * FROM press_pack_items ORDER BY pack_id, sort_order, created_at
    `).all() as PressPackItem[];
    res.json({ packs, items });
  } catch (error) {
    console.error('[Press] List packs failed:', error);
    res.status(500).json({ error: 'Failed to list Press packs' });
  }
});

router.post('/packs', (req, res) => {
  try {
    const name = cleanText(req.body?.name, 160);
    if (!name) {
      res.status(400).json({ error: 'Pack name is required' });
      return;
    }
    const requestedFormat = req.body?.sourceFormat as PressPackSourceFormat | undefined;
    const sourceFormat: PressPackSourceFormat = requestedFormat && PACK_SOURCE_FORMATS.has(requestedFormat)
      ? requestedFormat
      : 'images';
    const packSourceFileId = typeof req.body?.sourceFileId === 'string' ? req.body.sourceFileId : null;
    if (packSourceFileId && (!UUID_RE.test(packSourceFileId) || !getFile(packSourceFileId))) {
      res.status(400).json({ error: 'Pack sourceFileId does not exist' });
      return;
    }
    let metadataJson = '{}';
    if (req.body?.metadata !== undefined) {
      try {
        metadataJson = typeof req.body.metadata === 'string'
          ? req.body.metadata
          : JSON.stringify(req.body.metadata);
        const parsed = JSON.parse(metadataJson) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || metadataJson.length > MAX_PACK_METADATA_CHARS) {
          throw new Error('invalid metadata');
        }
      } catch {
        res.status(400).json({ error: 'Pack metadata must be an object under 128 KB' });
        return;
      }
    }
    const rawItems = req.body?.items;
    if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > MAX_PACK_ITEMS) {
      res.status(400).json({ error: `A pack needs 1-${MAX_PACK_ITEMS} items` });
      return;
    }

    const normalized: Array<{
      id: string;
      name: string;
      kind: PressPackItemKind;
      mimeType: string | null;
      sourceFileId: string | null;
      dataJson: string | null;
      width: number | null;
      height: number | null;
      sortOrder: number;
    }> = [];

    for (let index = 0; index < rawItems.length; index += 1) {
      const item = rawItems[index] as Record<string, unknown>;
      const kind = item?.kind as PressPackItemKind | undefined;
      const itemName = cleanText(item?.name, 255);
      if (!kind || !PACK_ITEM_KINDS.has(kind) || !itemName) {
        res.status(400).json({ error: `Pack item ${index + 1} is invalid` });
        return;
      }

      let sourceFileId: string | null = null;
      let dataJson: string | null = null;
      if (kind === 'image') {
        sourceFileId = typeof item.sourceFileId === 'string' ? item.sourceFileId : null;
        const sourceFile = sourceFileId && UUID_RE.test(sourceFileId) ? getFile(sourceFileId) : null;
        if (!sourceFileId || !sourceFile || !sourceFile.mimeType.startsWith('image/')) {
          res.status(400).json({ error: `Pack image ${index + 1} needs an uploaded source file` });
          return;
        }
        if (item.data !== undefined) {
          try {
            dataJson = typeof item.data === 'string' ? item.data : JSON.stringify(item.data);
            const parsed = JSON.parse(dataJson) as unknown;
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || dataJson.length > MAX_PACK_METADATA_CHARS) {
              throw new Error('invalid metadata');
            }
          } catch {
            res.status(400).json({ error: `Pack image ${index + 1} metadata is invalid or too large` });
            return;
          }
        }
      } else {
        try {
          dataJson = typeof item.data === 'string' ? item.data : JSON.stringify(item.data);
          if (!dataJson || dataJson.length > MAX_LIBRARY_ITEM_CHARS) throw new Error('too large');
          const parsed = JSON.parse(dataJson) as { id?: unknown; elements?: unknown };
          if (!parsed || typeof parsed.id !== 'string' || !Array.isArray(parsed.elements) || parsed.elements.length === 0) {
            throw new Error('invalid item');
          }
        } catch {
          res.status(400).json({ error: `Excalidraw item ${index + 1} is invalid or too large` });
          return;
        }
      }

      const width = Number(item.width);
      const height = Number(item.height);
      normalized.push({
        id: crypto.randomUUID(),
        name: itemName,
        kind,
        mimeType: typeof item.mimeType === 'string' ? item.mimeType.slice(0, 120) : null,
        sourceFileId,
        dataJson,
        width: Number.isFinite(width) && width > 0 ? Math.min(16384, Math.round(width)) : null,
        height: Number.isFinite(height) && height > 0 ? Math.min(16384, Math.round(height)) : null,
        sortOrder: index,
      });
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const db = getDb();
    db.transaction(() => {
      db.prepare(`
        INSERT INTO press_packs
          (id, name, description, source_format, author, license, source_file_id, metadata_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        name,
        cleanText(req.body?.description, 1000),
        sourceFormat,
        cleanText(req.body?.author, 160),
        cleanText(req.body?.license, 160),
        packSourceFileId,
        metadataJson,
        now,
        now,
      );
      const insert = db.prepare(`
        INSERT INTO press_pack_items
          (id, pack_id, name, kind, mime_type, source_file_id, data_json, width, height, sort_order, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      normalized.forEach((item) => insert.run(
        item.id,
        id,
        item.name,
        item.kind,
        item.mimeType,
        item.sourceFileId,
        item.dataJson,
        item.width,
        item.height,
        item.sortOrder,
        now,
      ));
    })();

    const pack = packById(id)!;
    const items = db.prepare('SELECT * FROM press_pack_items WHERE pack_id = ? ORDER BY sort_order')
      .all(id) as PressPackItem[];
    res.status(201).json({ pack, items });
  } catch (error) {
    console.error('[Press] Import pack failed:', error);
    res.status(500).json({ error: 'Failed to import Press pack' });
  }
});

router.delete('/packs/:id', (req, res) => {
  try {
    const pack = packById(req.params.id);
    if (!pack) {
      res.status(404).json({ error: 'Press pack not found' });
      return;
    }
    const db = getDb();
    db.transaction(() => {
      db.prepare('DELETE FROM press_pack_items WHERE pack_id = ?').run(pack.id);
      db.prepare('DELETE FROM press_packs WHERE id = ?').run(pack.id);
    })();
    res.json({ success: true });
  } catch (error) {
    console.error('[Press] Delete pack failed:', error);
    res.status(500).json({ error: 'Failed to delete Press pack' });
  }
});

export default router;
