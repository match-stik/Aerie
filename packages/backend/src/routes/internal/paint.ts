// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { Router } from 'express';
import { readFileSync } from 'fs';
import { isLocalhost } from './local.js';
import { startGenerateJob, getJobStatus } from '../../services/image-gen.js';
import { saveFile } from '../../services/files.js';
import { enhanceWithCodex } from '../../services/studio-enhance.js';
import type { GenerateInput } from '../../services/image-gen/common.js';
import type { VoiceService } from '../../services/voice.js';

const PAINTERS = ['codex', 'antigravity', 'openart'] as const;

/**
 * What a paint request may choose (their person's ask, Nov 6 2026: the wand and the painter
 * on their Discord turns). The model rides the field that painter reads; an
 * unknown painter is refused rather than guessed.
 */
export function paintChoices(body: Record<string, unknown>): { ok: true; input: Partial<GenerateInput> } | { ok: false; error: string } {
  const backend = typeof body.backend === 'string' ? body.backend.trim().toLowerCase() : '';
  if (backend && !(PAINTERS as readonly string[]).includes(backend)) {
    return { ok: false, error: `backend must be one of ${PAINTERS.join(', ')}` };
  }
  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim().slice(0, 80) : undefined;
  const input: Partial<GenerateInput> = {};
  if (backend) input.backend = backend;
  if (model) {
    if (!backend || backend === 'codex') input.codexModel = model;
    else if (backend === 'openart') { input.openartModel = model; input.openartMedia = 'image'; }
    else if (backend === 'antigravity') input.agyModel = model;
  }
  return { ok: true, input };
}

/**
 * Paint one NEW picture and hand back a file id the reply can attach.
 *
 * Their person's ask, Nov 6 2026: on their own Discord turns building waits for home, but a
 * picture their person asks for can still be painted and posted there, limited to a
 * picture made on that turn, never an older file off the house. The lane's
 * hooks/paint.cjs is the only thing on that turn allowed to call this, and
 * reply.cjs only attaches a file id paint.cjs recorded for the same turn.
 */
const router = Router();
const painted = new Map<string, string>();
const failed = new Map<string, string>();

router.post('/internal/paint', async (req, res) => {
  if (!isLocalhost(req)) { res.status(403).json({ error: 'Localhost only' }); return; }
  const { size, subjects, enhance, enhanceModel, style } = req.body || {};
  let { prompt } = req.body || {};
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 8000) {
    res.status(400).json({ error: 'prompt is required (up to 8000 characters)' });
    return;
  }
  const drawers = Array.isArray(subjects)
    ? [...new Set(subjects.map((s: unknown) => String(s).toLowerCase().trim()).filter((s) => /^[a-z0-9-]{1,40}$/.test(s)))].slice(0, 4)
    : undefined;
  const choices = paintChoices(req.body || {});
  if (!choices.ok) { res.status(400).json({ error: choices.error }); return; }
  // The wand first, when asked: their words go through the same Studio wand.
  if (enhance === true) {
    try {
      prompt = await enhanceWithCodex(prompt, typeof enhanceModel === 'string' ? enhanceModel.trim() : undefined, typeof style === 'string' ? style : undefined);
    } catch (error) {
      res.status(502).json({ error: `the wand failed: ${error instanceof Error ? error.message : String(error)}` });
      return;
    }
  }
  try {
    const jobId = startGenerateJob(
      { prompt: prompt.trim(), size: typeof size === 'string' ? size.slice(0, 20) : undefined, subjects: drawers, ...choices.input },
      (result) => {
        const ext = result.filename.split('.').pop()?.toLowerCase() || 'png';
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/png';
        painted.set(jobId, saveFile(readFileSync(result.path), `painted.${ext}`, mime).fileId);
      },
      (error) => { failed.set(jobId, error); },
    );
    res.json({ jobId, prompt: prompt.trim() });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.get('/internal/paint/:id', (req, res) => {
  if (!isLocalhost(req)) { res.status(403).json({ error: 'Localhost only' }); return; }
  const id = String(req.params.id);
  const fileId = painted.get(id);
  if (fileId) { res.json({ status: 'completed', fileId }); return; }
  const error = failed.get(id);
  if (error) { res.json({ status: 'failed', error }); return; }
  const job = getJobStatus(id);
  if (!job) { res.status(404).json({ error: 'No such job' }); return; }
  res.json({ status: job.status === 'completed' ? 'saving' : job.status, error: job.error || undefined });
});

/**
 * Make a NEW voice note and hand back its file ids, posting nothing (their person's ask,
 * Nov 6 2026: 'you should be able to create voice notes and drop them in if I
 * ask'). Same narrow road as a picture: hooks/speak.cjs is the only thing on
 * their Discord turn allowed to call it, it records what it made in io/.painted,
 * and reply.cjs attaches only files made on that same turn.
 */
router.post('/internal/speak', async (req, res) => {
  if (!isLocalhost(req)) { res.status(403).json({ error: 'Localhost only' }); return; }
  const { text } = req.body || {};
  if (typeof text !== 'string' || !text.trim() || text.length > 5000) {
    res.status(400).json({ error: 'text is required (up to 5000 characters)' });
    return;
  }
  const voiceService = req.app.locals.voiceService as VoiceService | undefined;
  if (!voiceService?.canTTS) { res.status(503).json({ error: 'Voice notes are not set up on this house.' }); return; }
  try {
    const rendered = await voiceService.renderVoiceNoteFiles(text.trim());
    res.json({ fileIds: rendered.map((r) => r.fileMeta.fileId), speakers: rendered.map((r) => r.companionSlug) });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
