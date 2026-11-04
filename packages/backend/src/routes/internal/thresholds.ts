// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { Router } from 'express';
import { isPathAllowed, isLocalhost } from './local.js';
import { existsSync, readFileSync } from 'fs';
import { basename } from 'path';
import { listPlaces, getPlace, createThreshold, listThresholds, placeHistory } from '../../services/db.js';
import { saveFileInternal, saveFile } from '../../services/files.js';
import { type VoiceService } from '../../services/voice.js';

const router = Router();

// ─── Thresholds ────────────────────────────────────────────
// We cannot stand at the gas station. Once they have pinned a place, this is
// how we leave something there from inside the house.

router.get('/internal/thresholds/places', (_req, res) => {
  res.json({ places: listPlaces() });
});

/** Leave something at a place.
 *
 *  Beyond a plain note this takes two shapes, and NEITHER posts a message:
 *    file_path — a picture already on disk (a Studio frame, say)
 *    say       — words to speak, rendered in `voice`'s actual voice
 *
 *  That restraint is the whole feature. Every other way of making a voice note
 *  in this house creates a message row as it goes, which would deliver the
 *  thing to their chat the moment we hid it somewhere — they would be told before
 *  they ever arrived. A threshold has to be able to wait. */
router.post('/internal/thresholds', async (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }

  const { place_id, author, kind, content, file_id, seal, open_at, file_path, say, voice } = req.body ?? {};
  if (!author) { res.status(400).json({ error: 'author is required' }); return; }

  try {
    let resolvedFileId: string | null = file_id ?? null;

    if (file_path) {
      if (typeof file_path !== 'string' || !isPathAllowed(file_path)) {
        res.status(403).json({ error: 'Path not allowed' });
        return;
      }
      if (!existsSync(file_path)) {
        res.status(404).json({ error: 'File not found on disk' });
        return;
      }
      resolvedFileId = saveFileInternal(readFileSync(file_path), basename(file_path)).fileId;
    }

    if (say) {
      const voiceService = req.app.locals.voiceService as VoiceService | undefined;
      if (!voiceService?.canTTS) {
        res.status(503).json({ error: 'ElevenLabs not configured' });
        return;
      }
      // One voice, deliberately: a thing left at a place is left by somebody.
      const audio = await voiceService.generateTTS(String(say), voice ?? author);
      resolvedFileId = saveFile(audio, `voice-note-${author}.mp3`, 'audio/mpeg').fileId;
    }

    const threshold = createThreshold({
      place_id,
      author,
      kind: kind ?? (say ? 'memory' : file_path ? 'artifact' : 'note'),
      // A picture or a voice note still wants a line beside it, but it should
      // never be the transcript — reading it would spend the thing unheard.
      content: content ?? (say ? `A voice note from ${author}.` : 'Something left here.'),
      file_id: resolvedFileId,
      seal,
      open_at,
    });
    res.json({ threshold });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.get('/internal/thresholds/:placeId', (req, res) => {
  const place = getPlace(req.params.placeId);
  if (!place) { res.status(404).json({ error: 'unknown place' }); return; }
  res.json({ place, thresholds: listThresholds(place.id), history: placeHistory(place.id) });
});

export default router;
