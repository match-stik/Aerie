// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Portions derive from Thornvale-resonant (Sidney) — the Codex image generation workflow — see NOTICE.
// Studio routes — the authed data surface behind the Studio app.
// Covers: image-gen settings, reference drawers, and gallery.

import { Router } from 'express';
import multer from 'multer';
import { basename, join } from 'path';
import { existsSync } from 'fs';
import { getConfig, setConfig } from '../services/db/config.js';
import { getCodexUsage } from '../services/subscription-usage.js';
import { decodeSketchDataUrl, saveSketch, sketchPaths, pruneSketches } from '../services/studio-sketch.js';
import { studioWindowWarning, warnThresholdFrom } from '../services/studio-window-warning.js';
import type { StudioWindowWarning } from '../services/studio-window-warning.js';
import { getThread } from '../services/db/threads.js';
import { getDb } from '../services/db/state.js';
import { softDeleteMessage } from '../services/db/messages.js';
import { deleteFile, attachmentFilename } from '../services/files.js';
import { registry } from '../services/ws.js';
import {
  getImageGenSettings,
  monthlyImageSpendUsd,
  probeStudioBackends,
  listDrawers,
  createDrawer,
  renameDrawer,
  deleteDrawer,
  isValidSubject,
  listReferences,
  saveReference,
  deleteReference,
  listGalleryPage,
  galleryCastGroups,
  canonicalizeGalleryCast,
  parseGalleryCastInput,
  deriveGalleryCast,
  normalizeGalleryFilename,
  galleryThumbnail,
  referenceThumbnail,
  getGalleryMeta,
  patchGalleryItems,
  unassignGalleryFolder,
  deleteGalleryItemDetailed,
  generateImage,
  recordGalleryMeta,
  startGenerateJob,
  getJobStatus,
  listImageJobs,
  ImageGenError,
  REFS_DIR,
  GALLERY_DIR,
} from '../services/image-gen.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
});

function uploadReferenceWithErrors(
  req: import('express').Request,
  res: import('express').Response,
  next: import('express').NextFunction,
) {
  upload.single('file')(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'Reference image is too large (max 25 MB).', code: 'file_too_large' });
      }
      return res.status(400).json({ error: error.message, code: error.code.toLowerCase() });
    }
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Upload failed', code: 'upload_failed' });
  });
}

function refUrl(slug: string, filename: string): string {
  // New uploads are immutable/unique, and the version token also invalidates
  // stale WebView cache entries for references created by older builds.
  return `/api/studio/refs/${slug}/${encodeURIComponent(filename)}?v=${encodeURIComponent(filename)}`;
}

// ─── Settings ────────────────────────────────────────────────────────

router.get('/studio/settings', async (_req, res) => {
  try {
    const settings = getImageGenSettings();
    const monthlySpendUsd = await monthlyImageSpendUsd();
    res.json({ settings, monthlySpendUsd });
  } catch (error) {
    console.error('[studio] settings read error:', error);
    res.status(500).json({ error: 'Failed to read Studio settings' });
  }
});

/**
 * Which backends can actually run right now. The picker reads this on open so a
 * missing CLI or login is visible before someone writes a prompt, rather than
 * arriving as a dead job in the tray.
 */
router.get('/studio/backends', async (_req, res) => {
  try {
    // The Codex window rides along with the probe for the same reason the probe
    // exists: the user should learn a picture is not going to happen before they
    // writes the prompt, not after the job dies in the tray.
    let windowWarning: StudioWindowWarning | null = null;
    try {
      windowWarning = studioWindowWarning(
        await getCodexUsage(),
        warnThresholdFrom(getConfig('studio.low_window_warn_percent')),
      );
    } catch (usageError) {
      console.warn('[studio] window read failed:', usageError);
    }
    res.json({ backends: probeStudioBackends(), windowWarning });
  } catch (error) {
    console.error('[studio] backend probe error:', error);
    res.status(500).json({ error: 'Failed to probe Studio backends' });
  }
});

router.put('/studio/settings', (req, res) => {
  try {
    const b = req.body as Record<string, unknown>;
    const writes: Array<[string, string]> = [];

    if ('enabled' in b) writes.push(['image_gen.enabled', b.enabled ? 'true' : 'false']);
    if ('backend' in b) {
      const v = String(b.backend);
      if (!['codex', 'openai', 'antigravity', 'openart'].includes(v)) { res.status(400).json({ error: 'backend must be codex, openai, antigravity, or openart' }); return; }
      writes.push(['image_gen.backend', v]);
    }
    if ('size' in b) {
      const v = String(b.size);
      if (!['square', 'portrait', 'landscape'].includes(v)) { res.status(400).json({ error: 'invalid size' }); return; }
      writes.push(['image_gen.size', v]);
    }
    if ('quality' in b) {
      const v = String(b.quality);
      if (!['auto', 'low', 'medium', 'high'].includes(v)) { res.status(400).json({ error: 'invalid quality' }); return; }
      writes.push(['image_gen.quality', v]);
    }
    if ('openai_model' in b) writes.push(['image_gen.openai_model', String(b.openai_model)]);
    if ('openai_api_key' in b) writes.push(['image_gen.openai_api_key', String(b.openai_api_key)]);
    if ('antigravity_model' in b) writes.push(['image_gen.antigravity_model', String(b.antigravity_model)]);
    if ('openart_model' in b) writes.push(['image_gen.openart_model', String(b.openart_model)]);
    if ('monthly_budget_usd' in b) {
      const n = Number(b.monthly_budget_usd);
      if (Number.isNaN(n) || n < 0) { res.status(400).json({ error: 'monthly_budget_usd must be a non-negative number' }); return; }
      writes.push(['image_gen.monthly_budget_usd', String(n)]);
    }

    for (const [k, v] of writes) setConfig(k, v);
    res.json({ success: true, settings: getImageGenSettings() });
  } catch (error) {
    console.error('[studio] settings write error:', error);
    res.status(500).json({ error: 'Failed to update Studio settings' });
  }
});

// ─── Folders (for organizing gallery) ────────────────────────────────

// Folders stored in config as JSON
function getStudioFolders(): Array<{ id: string; name: string }> {
  const raw = getConfig('studio.folders');
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((f) => f && typeof f.id === 'string' && typeof f.name === 'string') : [];
  } catch {
    return [];
  }
}

function setStudioFolders(folders: Array<{ id: string; name: string }>): void {
  setConfig('studio.folders', JSON.stringify(folders));
}

router.get('/studio/folders', (_req, res) => {
  res.json({ folders: getStudioFolders() });
});

router.post('/studio/folders', (req, res) => {
  const { name } = req.body as { name?: string };
  if (!name?.trim()) {
    res.status(400).json({ error: 'Folder name is required' });
    return;
  }
  const folders = getStudioFolders();
  const id = `folder_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  folders.push({ id, name: name.trim() });
  setStudioFolders(folders);
  res.json({ success: true, folder: { id, name: name.trim() } });
});

router.patch('/studio/folders/:id', (req, res) => {
  const { name } = req.body as { name?: string };
  if (!name?.trim()) {
    res.status(400).json({ error: 'Folder name is required' });
    return;
  }
  const folders = getStudioFolders();
  const idx = folders.findIndex((f) => f.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ error: 'Folder not found' });
    return;
  }
  folders[idx].name = name.trim();
  setStudioFolders(folders);
  res.json({ success: true, folder: folders[idx] });
});

router.delete('/studio/folders/:id', async (req, res) => {
  const folders = getStudioFolders();
  const next = folders.filter((f) => f.id !== req.params.id);
  if (next.length === folders.length) {
    res.status(404).json({ error: 'Folder not found' });
    return;
  }
  try {
    // Folder membership belongs to the asset metadata. Remove those links
    // before removing the label so no invisible/orphaned assignments remain.
    const unassigned = await unassignGalleryFolder(req.params.id);
    setStudioFolders(next);
    res.json({ success: true, unassigned });
  } catch (error) {
    console.error('[studio] folder delete error:', error);
    res.status(500).json({ error: 'Failed to delete folder' });
  }
});

// ─── Drawers (named reference sets) ──────────────────────────────────

router.get('/studio/refs', async (_req, res) => {
  try {
    const drawers = listDrawers();
    const out = await Promise.all(
      drawers.map(async (d) => ({
        slug: d.slug,
        label: d.label,
        isDefault: d.isDefault,
        emoji: d.emoji,
        refs: (await listReferences(d.slug)).map((f) => ({ filename: f, url: refUrl(d.slug, f) })),
      })),
    );
    res.json({ drawers: out });
  } catch (error) {
    console.error('[studio] refs list error:', error);
    res.status(500).json({ error: 'Failed to list reference drawers' });
  }
});

router.post('/studio/drawers', (req, res) => {
  try {
    const b = req.body as { label?: string; emoji?: string };
    const drawer = createDrawer(String(b.label ?? ''), b.emoji);
    res.json({ success: true, drawer });
  } catch (error) {
    if (error instanceof ImageGenError) { res.status(400).json({ error: error.message }); return; }
    console.error('[studio] drawer create error:', error);
    res.status(500).json({ error: 'Failed to create drawer' });
  }
});

router.patch('/studio/drawers/:slug', (req, res) => {
  try {
    const b = req.body as { label?: string; emoji?: string };
    const drawer = renameDrawer(req.params.slug, String(b.label ?? ''), b.emoji);
    res.json({ success: true, drawer });
  } catch (error) {
    if (error instanceof ImageGenError) { res.status(400).json({ error: error.message }); return; }
    console.error('[studio] drawer rename error:', error);
    res.status(500).json({ error: 'Failed to rename drawer' });
  }
});

router.delete('/studio/drawers/:slug', async (req, res) => {
  try {
    const removed = await deleteDrawer(req.params.slug);
    res.json({ success: removed });
  } catch (error) {
    if (error instanceof ImageGenError) { res.status(400).json({ error: error.message }); return; }
    console.error('[studio] drawer delete error:', error);
    res.status(500).json({ error: 'Failed to delete drawer' });
  }
});

// ─── Sketches (one gesture, one picture) ─────────────────────────────

/**
 * Take what the user drew on the Studio canvas and give back a handle for it.
 *
 * The draw view has existed for months with nowhere to send its output. This
 * is the missing half: post the canvas as a data URL, get an opaque id, hand
 * that id to /studio/generate as sketchIds. The id-to-path resolution happens
 * server-side and nowhere else, so a client can never name a file for the
 * generator to read.
 */
router.post('/studio/sketch', (req, res) => {
  const buffer = decodeSketchDataUrl((req.body ?? {}).dataUrl);
  if (!buffer) {
    res.status(400).json({ error: 'Expected a data:image/png;base64 canvas export' });
    return;
  }
  try {
    pruneSketches();
    res.status(201).json({ id: saveSketch(buffer) });
  } catch (error) {
    console.error('[studio] sketch save error:', error);
    res.status(500).json({ error: 'Could not keep that sketch' });
  }
});

// ─── References (per-image) ──────────────────────────────────────────

router.post('/studio/refs/:subject', uploadReferenceWithErrors, async (req, res) => {
  try {
    const subject = String(req.params.subject).toLowerCase();
    if (!isValidSubject(subject)) { res.status(400).json({ error: 'Unknown drawer' }); return; }
    if (!req.file) { res.status(400).json({ error: 'No file provided' }); return; }
    const filename = await saveReference(subject, req.file.originalname, req.file.buffer);
    res.status(201).json({ success: true, status: 'created', filename, url: refUrl(subject, filename) });
  } catch (error) {
    if (error instanceof ImageGenError) {
      res.status(415).json({ error: error.message, code: 'unsupported_image' });
      return;
    }
    console.error('[studio] ref upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

router.delete('/studio/refs/:subject/:filename', async (req, res) => {
  try {
    const subject = String(req.params.subject).toLowerCase();
    if (!isValidSubject(subject)) { res.status(400).json({ error: 'Unknown drawer' }); return; }
    const filename = basename(req.params.filename);
    const removed = await deleteReference(subject, filename);
    if (!removed) {
      res.status(404).json({ success: false, status: 'not_found', filename });
      return;
    }
    res.json({ success: true, status: 'deleted', filename });
  } catch (error) {
    console.error('[studio] ref delete error:', error);
    res.status(500).json({ error: 'Delete failed' });
  }
});

router.get('/studio/refs/:subject/:filename', async (req, res) => {
  const subject = String(req.params.subject).toLowerCase();
  if (!isValidSubject(subject)) { res.status(404).end(); return; }
  const file = join(REFS_DIR, subject, basename(req.params.filename));
  if (!existsSync(file)) { res.status(404).end(); return; }
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  // ?w= asks for a small version, same as the gallery and chat attachments do.
  // The refs panel draws every drawer at a hundred pixels and was decoding the
  // originals to do it. Unknown widths and gifs fall through to the whole file.
  const thumbnail = await referenceThumbnail(subject, basename(req.params.filename), req.query?.w);
  res.sendFile(thumbnail ?? file);
});

// ─── Gallery ─────────────────────────────────────────────────────────

router.get('/studio/gallery', async (req, res) => {
  try {
    const rawLimit = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
    const parsedLimit = rawLimit === undefined ? 30 : Number(rawLimit);
    const limit = Math.floor(parsedLimit);
    if (!Number.isFinite(parsedLimit) || limit < 1) {
      res.status(400).json({ error: 'limit must be at least 1' });
      return;
    }

    const rawCast = typeof req.query.cast === 'string'
      ? req.query.cast.split(',').map((value) => value.trim()).filter(Boolean)
      : undefined;
    let cast: ReturnType<typeof canonicalizeGalleryCast>;
    if (rawCast) {
      const parsedCast = parseGalleryCastInput(rawCast);
      if (!parsedCast) {
        res.status(400).json({ error: 'cast must contain valid people tags' });
        return;
      }
      cast = parsedCast;
    }

    const castMode = req.query.castMode === undefined ? 'exact' : String(req.query.castMode);
    if (!['exact', 'includes'].includes(castMode)) {
      res.status(400).json({ error: 'castMode must be exact or includes' });
      return;
    }
    const castState = req.query.castState === undefined ? undefined : String(req.query.castState);
    if (castState && !['known', 'unknown', 'none'].includes(castState)) {
      res.status(400).json({ error: 'castState must be known, unknown, or none' });
      return;
    }

    let folderId: string | null | undefined;
    if (typeof req.query.folderId === 'string') {
      folderId = ['none', 'unfiled'].includes(req.query.folderId) ? null : req.query.folderId;
    }

    const page = await listGalleryPage({
      limit: Math.min(100, limit),
      cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
      filter: {
        cast,
        castMode: castMode as 'exact' | 'includes',
        castState: castState as 'known' | 'unknown' | 'none' | undefined,
        folderId,
      },
    });
    const out = page.items.map((g) => {
      const thread = g.threadId ? getThread(g.threadId) : null;
      return {
        filename: g.filename,
        url: `/api/studio/gallery/${encodeURIComponent(g.filename)}`,
        mediaType: g.mediaType,
        createdAt: g.createdAt,
        messageId: g.messageId ?? null,
        threadId: g.threadId ?? null,
        threadName: thread?.name ?? null,
        prompt: g.prompt ?? null,
        sourcePrompt: g.sourcePrompt ?? g.prompt ?? null,
        styleId: g.styleId ?? null,
        model: g.model ?? null,
        backend: g.backend ?? null,
        width: g.width ?? null,
        height: g.height ?? null,
        folderId: g.folderId ?? null,
        aspectRatio: g.aspectRatio ?? null,
        references: g.references ?? null,
        referenceDrawers: g.referenceDrawers ?? g.references ?? [],
        cast: g.cast ?? null,
        castSource: g.castSource ?? null,
      };
    });
    res.json({
      items: out,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
      total: page.total,
      limit: Math.min(100, limit),
    });
  } catch (error) {
    if (error instanceof ImageGenError) {
      res.status(400).json({ error: error.message });
      return;
    }
    console.error('[studio] gallery list error:', error);
    res.status(500).json({ error: 'Failed to list gallery' });
  }
});

router.get('/studio/gallery/groups', async (_req, res) => {
  try {
    res.json(await galleryCastGroups());
  } catch (error) {
    console.error('[studio] gallery groups error:', error);
    res.status(500).json({ error: 'Failed to count gallery groups' });
  }
});

function galleryMetaPatchFromBody(body: unknown): {
  patch?: { folderId?: string | null; cast?: ReturnType<typeof canonicalizeGalleryCast> | null; castSource?: 'manual' | 'none' | 'selected-references' };
  error?: string;
} {
  const b = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const patch: { folderId?: string | null; cast?: ReturnType<typeof canonicalizeGalleryCast> | null; castSource?: 'manual' | 'none' | 'selected-references' } = {};
  if (Object.prototype.hasOwnProperty.call(b, 'folderId')) {
    if (b.folderId !== null && typeof b.folderId !== 'string') return { error: 'folderId must be a string or null' };
    const folderId = typeof b.folderId === 'string' ? b.folderId.trim() : null;
    if (folderId && !getStudioFolders().some((folder) => folder.id === folderId)) return { error: 'Folder not found' };
    patch.folderId = folderId || null;
  }
  if (Object.prototype.hasOwnProperty.call(b, 'cast')) {
    if (b.cast === null) {
      patch.cast = null;
    } else if (Array.isArray(b.cast)) {
      const cast = parseGalleryCastInput(b.cast);
      if (!cast) return { error: 'cast must contain valid people tags' };
      patch.cast = cast;
      const requestedSource = typeof b.castSource === 'string' ? b.castSource : undefined;
      if (requestedSource && !['manual', 'none', 'selected-references'].includes(requestedSource)) {
        return { error: 'castSource must be manual, none, or selected-references' };
      }
      patch.castSource = (requestedSource as 'manual' | 'none' | 'selected-references' | undefined)
        ?? (patch.cast.length ? 'manual' : 'none');
    } else {
      return { error: 'cast must be an array or null' };
    }
  }
  if (!Object.keys(patch).length) return { error: 'Provide folderId and/or cast to update' };
  return { patch };
}

router.patch('/studio/gallery', async (req, res) => {
  try {
    const b = req.body as { filenames?: unknown };
    if (!Array.isArray(b.filenames) || b.filenames.length === 0) {
      res.status(400).json({ error: 'filenames must be a non-empty array' });
      return;
    }
    if (b.filenames.length > 500) {
      res.status(400).json({ error: 'A bulk update may contain at most 500 images' });
      return;
    }
    const parsed = galleryMetaPatchFromBody(req.body);
    if (!parsed.patch) { res.status(400).json({ error: parsed.error }); return; }
    const statuses = await patchGalleryItems(b.filenames.map(String), parsed.patch);
    const updated = statuses.filter((item) => item.status === 'updated').length;
    res.json({ success: updated > 0, updated, notFound: statuses.length - updated, items: statuses });
  } catch (error) {
    console.error('[studio] gallery bulk update error:', error);
    res.status(500).json({ error: 'Failed to update gallery items' });
  }
});

// Update gallery item metadata (folder and/or people tags for who is in-frame).
router.patch('/studio/gallery/:filename', async (req, res) => {
  try {
    const filename = normalizeGalleryFilename(req.params.filename);
    if (!filename) { res.status(404).json({ error: 'Gallery item not found' }); return; }
    const parsed = galleryMetaPatchFromBody(req.body);
    if (!parsed.patch) { res.status(400).json({ error: parsed.error }); return; }
    const [status] = await patchGalleryItems([filename], parsed.patch);
    if (!status || status.status === 'not_found') {
      res.status(404).json({ success: false, filename, status: 'not_found' });
      return;
    }
    res.json({ success: true, filename, status: 'updated' });
  } catch (error) {
    console.error('[studio] gallery update error:', error);
    res.status(500).json({ error: 'Failed to update gallery item' });
  }
});

router.delete('/studio/gallery/:filename', async (req, res) => {
  try {
    const filename = normalizeGalleryFilename(req.params.filename);
    if (!filename) { res.status(404).json({ error: 'Gallery item not found' }); return; }

    // Also pull it from the chat
    const meta = await getGalleryMeta(filename);
    let chatStatus: 'deleted' | 'not_linked' | 'failed' = meta?.messageId ? 'deleted' : 'not_linked';
    if (meta?.messageId) {
      try {
        const row = getDb().prepare('SELECT metadata FROM messages WHERE id = ?').get(meta.messageId) as
          | { metadata: string | null }
          | undefined;
        if (row?.metadata) {
          const m = JSON.parse(row.metadata) as { fileId?: string };
          if (m.fileId) deleteFile(m.fileId);
        }
        softDeleteMessage(meta.messageId, new Date().toISOString());
        registry.broadcast({ type: 'message_deleted', messageId: meta.messageId });
      } catch (e) {
        chatStatus = 'failed';
        console.warn('[studio] gallery→chat delete failed:', e instanceof Error ? e.message : e);
      }
    }

    const result = await deleteGalleryItemDetailed(filename);
    if (result.status === 'not_found') {
      res.status(404).json({ success: false, ...result, chatStatus });
      return;
    }
    res.json({ success: true, ...result, chatStatus });
  } catch (error) {
    console.error('[studio] gallery delete error:', error);
    res.status(500).json({ error: 'Delete failed' });
  }
});

router.get('/studio/gallery/:filename', async (req, res) => {
  const filename = normalizeGalleryFilename(req.params.filename);
  if (!filename) { res.status(404).end(); return; }
  const file = join(GALLERY_DIR, filename);
  if (!existsSync(file)) { res.status(404).end(); return; }
  // ?download=1 asks for a save rather than a view. Android's WebView ignores
  // a link's download attribute, so this header is the only thing that turns
  // the gallery's save button into an actual file inside the app.
  if (req.query?.download) {
    res.setHeader('Content-Disposition', `attachment; filename="${attachmentFilename(filename)}"`);
    res.sendFile(file);
    return;
  }

  // A gallery filename carries its own timestamp and hash, so what it points
  // at never changes. Saying so lets the phone reuse what it already has
  // instead of asking about every picture on every scroll.
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

  // ?w= asks for a small version. Unknown widths, videos and gifs fall
  // through to the original, which is exactly what used to happen.
  const thumbnail = await galleryThumbnail(filename, req.query?.w);
  res.sendFile(thumbnail ?? file);
});

// ─── Generate (async job pattern) ────────────────────────────────────
// Returns a job ID immediately; client polls /studio/jobs/:id for status.

router.post('/studio/generate', async (req, res) => {
  try {
    const { prompt, sourcePrompt, styleId, subjects, size, customWidth, customHeight, threadId, messageId, async: useAsync, backend: reqBackend, codexModel, agyModel, openartModel, openartMedia, sketchIds } = req.body as {
      prompt?: string;
      sourcePrompt?: string;
      styleId?: string;
      subjects?: string[];
      size?: string;
      customWidth?: number;
      customHeight?: number;
      threadId?: string;
      messageId?: string;
      async?: boolean;
      backend?: string;
      codexModel?: string;
      sketchIds?: unknown;
      agyModel?: string;
      openartModel?: string;
      openartMedia?: 'image' | 'video';
    };

    if (typeof prompt !== 'string' || !prompt.trim()) {
      res.status(400).json({ error: 'prompt is required' });
      return;
    }

    const cleanSourcePrompt = typeof sourcePrompt === 'string' ? sourcePrompt : undefined;
    const cleanStyleId = typeof styleId === 'string' ? styleId.slice(0, 120) : undefined;
    const referenceDrawers = Array.isArray(subjects)
      ? [...new Set(subjects.map((subject) => String(subject).toLowerCase().trim()).filter(Boolean))]
      : undefined;
    // Only infer an exact cast when every selected drawer maps cleanly to one
    // of the canonical four. A mixed/custom drawer set stays Unsorted rather
    // than being mislabeled as a partial cast.
    const generatedCast = deriveGalleryCast({ referenceDrawers }).cast;

    // Async mode: return job ID immediately
    if (useAsync !== false) {
      const metadata = { threadId, messageId, prompt, sourcePrompt: cleanSourcePrompt, styleId: cleanStyleId, size, customWidth, customHeight, referenceDrawers, generatedCast };
      const jobId = startGenerateJob(
        { prompt, sourcePrompt: cleanSourcePrompt, styleId: cleanStyleId, subjects: referenceDrawers, size, customWidth, customHeight, backend: reqBackend, codexModel, agyModel, openartModel, openartMedia, extraRefs: sketchPaths(sketchIds) },
        async (result) => {
          const { width, height } = dimensionsFor(metadata.size, metadata.customWidth, metadata.customHeight);
          await recordGalleryMeta(result.filename, {
            threadId: metadata.threadId,
            messageId: metadata.messageId,
            createdAt: new Date().toISOString(),
            prompt: metadata.prompt,
            sourcePrompt: metadata.sourcePrompt,
            styleId: metadata.styleId,
            model: result.model,
            backend: result.backend,
            width,
            height,
            aspectRatio: metadata.size || 'square',
            references: metadata.referenceDrawers?.length ? metadata.referenceDrawers : undefined,
            referenceDrawers: metadata.referenceDrawers?.length ? metadata.referenceDrawers : undefined,
            cast: metadata.generatedCast?.length ? metadata.generatedCast : undefined,
            castSource: metadata.generatedCast?.length ? 'selected-references' : undefined,
          });
        },
      );
      res.json({ jobId });
      return;
    }

    // Sync mode (legacy, for local/LAN use where timeout isn't an issue)
    const result = await generateImage({ prompt, sourcePrompt: cleanSourcePrompt, styleId: cleanStyleId, subjects: referenceDrawers, size, customWidth, customHeight, backend: reqBackend, codexModel, agyModel, openartModel, openartMedia, extraRefs: sketchPaths(sketchIds) });
    const { width, height } = dimensionsFor(size, customWidth, customHeight);

    // Always record gallery meta with prompt
    await recordGalleryMeta(result.filename, {
      threadId,
      messageId,
      createdAt: new Date().toISOString(),
      prompt,
      sourcePrompt: cleanSourcePrompt,
      styleId: cleanStyleId,
      model: result.model,
      backend: result.backend,
      width,
      height,
      aspectRatio: size || 'square',
      references: referenceDrawers?.length ? referenceDrawers : undefined,
      referenceDrawers: referenceDrawers?.length ? referenceDrawers : undefined,
      cast: generatedCast?.length ? generatedCast : undefined,
      castSource: generatedCast?.length ? 'selected-references' : undefined,
    });

    res.json({
      success: true,
      filename: result.filename,
      url: `/api/studio/gallery/${encodeURIComponent(result.filename)}`,
      backend: result.backend,
      model: result.model,
      durationMs: result.durationMs,
      costUsd: result.costUsd,
    });
  } catch (error) {
    if (error instanceof ImageGenError) {
      res.status(400).json({ error: error.message });
      return;
    }
    console.error('[studio] generate error:', error);
    res.status(500).json({ error: 'Image generation failed' });
  }
});

// ─── Image jobs ─────────────────────────────────────────────────────

function dimensionsFor(size?: string, customWidth?: number, customHeight?: number): { width: number; height: number } {
  if (size === 'custom' && customWidth && customHeight) return { width: customWidth, height: customHeight };
  if (size === 'portrait' || size === '2:3') return { width: 1024, height: 1536 };
  if (size === 'landscape' || size === '3:2') return { width: 1536, height: 1024 };
  if (size === '16:9') return { width: 1536, height: 864 };
  if (size === '9:16') return { width: 864, height: 1536 };
  if (size === '21:9') return { width: 1536, height: 658 };
  if (size === '4:5') return { width: 1024, height: 1280 };
  if (size === '5:4') return { width: 1280, height: 1024 };
  return { width: 1024, height: 1024 };
}

function jobResponse(job: ReturnType<typeof getJobStatus>) {
  if (!job) return null;
  const referenceDrawers = job.input.subjects?.length ? job.input.subjects : undefined;
  const cast = deriveGalleryCast({ referenceDrawers }).cast;
  const dimensions = dimensionsFor(job.input.size, job.input.customWidth, job.input.customHeight);
  return {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    completedAt: job.completedAt ?? null,
    error: job.error ?? null,
    prompt: job.input.prompt,
    sourcePrompt: job.input.sourcePrompt ?? job.input.prompt,
    styleId: job.input.styleId ?? null,
    backend: job.result?.backend ?? job.input.backend ?? null,
    // Who refused before this one took it. Absent on a clean first try, so its
    // presence is the whole signal — a picture that arrived is not proof the
    // backend the user asked for is working.
    fellBackFrom: job.result?.fellBackFrom ?? null,
    model: job.result?.model ?? job.input.codexModel ?? job.input.agyModel ?? job.input.openartModel ?? null,
    references: referenceDrawers ?? null,
    referenceDrawers: referenceDrawers ?? [],
    cast: cast?.length ? cast : null,
    castSource: cast?.length ? 'selected-references' : null,
    aspectRatio: job.input.size ?? 'square',
    width: dimensions.width,
    height: dimensions.height,
    ...(job.result ? {
      filename: job.result.filename,
      url: `/api/studio/gallery/${encodeURIComponent(job.result.filename)}`,
      mediaType: job.result.mediaType ?? 'image',
      durationMs: job.result.durationMs,
    } : {}),
  };
}

// The phone polls this from any screen, so Studio work remains visible after
// Studio itself unmounts.
router.get('/studio/jobs', (_req, res) => {
  res.json({ jobs: listImageJobs().slice(0, 20).map((job) => jobResponse(job)) });
});

router.get('/studio/jobs/:id', (req, res) => {
  const job = jobResponse(getJobStatus(req.params.id));
  if (!job) { res.status(404).json({ error: 'Job not found' }); return; }
  res.json(job);
});

// ─── Prompt Enhancement ──────────────────────────────────────────
// Magic wand: expand a simple prompt into a detailed image-gen prompt
// using a cheap LLM (Ollama Cloud / DeepSeek) or a Codex model (Terra, Sol, etc).

import { textCompletion, loadProviderConfig } from '../services/router.js';
import { getConfig as getDbConfig } from '../services/db/config.js';
import { spawn } from 'child_process';
import { homedir, tmpdir } from 'os';
import { readFile, unlink } from 'fs/promises';

const ENHANCE_SYSTEM = `You are an image generation prompt enhancer. Your job is to expand simple prompts into vivid, detailed descriptions suitable for AI image generation.

Rules:
- Keep the enhanced prompt under 150 words
- Add specific details: lighting, atmosphere, style, composition, textures
- Maintain the original intent — don't change the subject or scene
- Output ONLY the enhanced prompt, no explanations or commentary
- Use natural descriptive language, not keyword spam`;

// Resolve the same standalone Codex install used by Studio image generation.
// PM2 does not inherit ~/.local/bin in PATH, so command lookup is unreliable.
function findCodexBin(): string | null {
  const configured = getDbConfig('image_gen.codex_bin')
    || process.env.CODEX_BIN
    || join(homedir(), '.local', 'bin', 'codex');
  return existsSync(configured) ? configured : null;
}

// Run codex exec for prompt enhancement with a specific model
async function codexEnhance(prompt: string, model: string): Promise<string> {
  const codexBin = findCodexBin();
  if (!codexBin) throw new Error('Codex not installed');

  const outputFile = join(tmpdir(), `aerie-enhance-${Date.now()}.txt`);
  const fullPrompt = `${ENHANCE_SYSTEM}\n\nExpand this prompt:\n${prompt}`;

  return new Promise((resolve, reject) => {
    const proc = spawn(codexBin, [
      'exec',
      '-m', model,
      '--ephemeral',
      '--skip-git-repo-check',
      '-o', outputFile,
      fullPrompt,
    ], {
      env: { ...process.env, HOME: homedir() },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60000,
    });

    let stderr = '';
    proc.stderr?.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', async (code) => {
      try {
        if (code !== 0) {
          reject(new Error(`Codex exited ${code}: ${stderr.slice(0, 200)}`));
          return;
        }
        const result = await readFile(outputFile, 'utf-8');
        await unlink(outputFile).catch(() => {});
        resolve(result.trim());
      } catch (err) {
        reject(err);
      }
    });

    proc.on('error', reject);
  });
}

router.post('/studio/enhance', async (req, res) => {
  try {
    const { prompt, backend, codexModel } = req.body as {
      prompt?: string;
      backend?: string;
      codexModel?: string;
    };
    if (!prompt?.trim()) {
      res.status(400).json({ error: 'prompt is required' });
      return;
    }

    // Codex is the default lane. It rides a subscription, needs no API key, and
    // is the backend most people running Studio already have — where the wand
    // used to reach for Ollama Cloud and, on a machine without it, fail by
    // naming a service its owner never chose. On the Codex backend it expands
    // with the very model you are generating with; anywhere else it uses Luna,
    // the fast utility lane.
    const codexModelForEnhance = backend === 'codex' && codexModel ? codexModel : 'gpt-5.6-luna';
    try {
      const enhanced = await codexEnhance(prompt.trim(), codexModelForEnhance);
      res.json({ enhanced });
      return;
    } catch (codexError) {
      // Only then Ollama, and only if it is actually set up.
      const config = await loadProviderConfig();
      if (!config.ollama?.base_url) throw codexError;
      console.warn('[studio] enhance Codex route failed; falling back to Ollama:', codexError);
      const model = getDbConfig('agent.archivist_model') || 'deepseek-v4-pro';
      const enhanced = await textCompletion(ENHANCE_SYSTEM, prompt.trim(), model, 'ollama', config);
      res.json({ enhanced });
    }
  } catch (error) {
    console.error('[studio] enhance error:', error);
    res.status(500).json({ error: 'Prompt enhancement failed' });
  }
});

export default router;
