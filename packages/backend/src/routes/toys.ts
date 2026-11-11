// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Their person's phone's side of the road from a lane to the toys: what it says
// about the toys whenever they change (POST /api/toys/state), and its answer
// to each command a lane sent (POST /api/toys/ack). Behind their person's login,
// because only their person's own phone has anything to say here.

import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { recordPhoneState, recordToyAck } from '../services/toy-remote.js';
import { deletePattern, listPatterns, patternName, renamePattern, savePattern, shapePattern } from '../services/toy-patterns.js';
import multer from 'multer';
import { saveFile } from '../services/files.js';
import { soundEnvelope, ENVELOPE_STEP_MS } from '../services/sound-envelope.js';
import { addPlaylist, addSound, listPlaylists, listSounds, nameFromFilename, playlistIds, removePlaylist, removeSound, renameSound, soundName, SOUND_MAX_BYTES, updatePlaylist } from '../services/toy-sounds.js';

const router = Router();
router.use(authMiddleware);

router.post('/state', (req, res) => {
  if (!recordPhoneState(req.body)) {
    res.status(400).json({ ok: false, error: 'Not a toy state' });
    return;
  }
  res.json({ ok: true });
});

router.post('/ack', (req, res) => {
  res.json({ ok: true, matched: recordToyAck(req.body) });
});

// The pattern shelf, from the Toys page: everything on it (steps included,
// because the phone plays them itself and draws their shape), and the ones
// their person records, renames or clears away. A pattern their person saves
// is theirs: companion null.
router.get('/patterns', (_req, res) => {
  res.json({ patterns: listPatterns() });
});

router.post('/patterns', (req, res) => {
  const shaped = shapePattern(req.body);
  if (!shaped.ok) {
    res.status(400).json({ ok: false, error: shaped.error });
    return;
  }
  const saved = savePattern({ name: shaped.name, companion: null, tracks: shaped.tracks, lengthMs: shaped.lengthMs });
  if ('error' in saved) {
    res.status(409).json({ ok: false, error: saved.error });
    return;
  }
  res.json({ ok: true, pattern: saved });
});

router.patch('/patterns/:id', (req, res) => {
  const name = patternName(req.body?.name);
  if (!name) {
    res.status(400).json({ ok: false, error: 'A name is 1 to 60 characters.' });
    return;
  }
  res.status(renamePattern(req.params.id, name) ? 200 : 404).json({ ok: true });
});

router.delete('/patterns/:id', (req, res) => {
  res.status(deletePattern(req.params.id) ? 200 : 404).json({ ok: true });
});

export default router;

// The sound shelf (services/toy-sounds.ts): their audio to play while the remote
// is handed over or while they play on their own. Its own upload door, because
// a read-aloud runs past the general upload's 10 MB.
const soundUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: SOUND_MAX_BYTES } });

router.get('/sounds', (_req, res) => {
  res.json({ sounds: listSounds() });
});

router.post('/sounds', (req, res, next) => {
  soundUpload.single('file')(req, res, (err: unknown) => {
    if (err) {
      const tooBig = (err as { code?: string }).code === 'LIMIT_FILE_SIZE';
      res.status(tooBig ? 413 : 400).json({ ok: false, error: tooBig ? `That file is over ${SOUND_MAX_BYTES / 1024 / 1024} MB.` : 'The upload did not come through.' });
      return;
    }
    next();
  });
}, (req, res) => {
  const file = (req as unknown as { file?: { buffer: Buffer; originalname?: string; mimetype: string } }).file;
  if (!file) {
    res.status(400).json({ ok: false, error: 'No file came with that.' });
    return;
  }
  const original = (file.originalname || 'sound').replace(/[\\/]/g, '_').slice(0, 200);
  try {
    const meta = saveFile(file.buffer, original, file.mimetype, SOUND_MAX_BYTES);
    if (meta.contentType !== 'audio') {
      res.status(400).json({ ok: false, error: 'That is not an audio file (mp3, m4a, wav, ogg or webm).' });
      return;
    }
    const name = soundName((req.body as { name?: unknown })?.name) ?? nameFromFilename(original);
    res.json({ ok: true, sound: addSound({ name, fileId: meta.fileId, size: meta.size }) });
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'That file would not save.' });
  }
});

router.patch('/sounds/:id', (req, res) => {
  const name = soundName(req.body?.name);
  if (!name) {
    res.status(400).json({ ok: false, error: 'A name is 1 to 80 characters.' });
    return;
  }
  res.status(renameSound(req.params.id, name) ? 200 : 404).json({ ok: true });
});

// A sound's loudness as a toy line, one level 0 to 20 every tenth of a
// second, for the phone to drive their toys in time with it.
router.get('/sounds/:id/envelope', async (req, res) => {
  const sound = listSounds().find((s) => s.id === req.params.id);
  if (!sound) {
    res.status(404).json({ ok: false, error: 'No sound by that id.' });
    return;
  }
  try {
    const levels = await soundEnvelope(sound.fileId);
    if (!levels) {
      res.status(404).json({ ok: false, error: 'The sound file is missing.' });
      return;
    }
    res.json({ ok: true, stepMs: ENVELOPE_STEP_MS, levels });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'The sound would not read.' });
  }
});

router.delete('/sounds/:id', (req, res) => {
  res.status(removeSound(req.params.id) ? 200 : 404).json({ ok: true });
});

// Playlists of shelf sounds, played one after another (services/toy-sounds.ts).
router.get('/sound-playlists', (_req, res) => {
  res.json({ playlists: listPlaylists() });
});

router.post('/sound-playlists', (req, res) => {
  const name = soundName(req.body?.name);
  const ids = playlistIds(req.body?.soundIds, new Set(listSounds().map((s) => s.id)));
  if (!name) {
    res.status(400).json({ ok: false, error: 'A name is 1 to 80 characters.' });
    return;
  }
  if (!ids || ids.length === 0) {
    res.status(400).json({ ok: false, error: 'Pick at least one sound from the shelf.' });
    return;
  }
  res.json({ ok: true, playlist: addPlaylist(name, ids) });
});

router.patch('/sound-playlists/:id', (req, res) => {
  const change: { name?: string; soundIds?: string[] } = {};
  if (req.body?.name !== undefined) {
    const name = soundName(req.body.name);
    if (!name) {
      res.status(400).json({ ok: false, error: 'A name is 1 to 80 characters.' });
      return;
    }
    change.name = name;
  }
  if (req.body?.soundIds !== undefined) {
    const ids = playlistIds(req.body.soundIds, new Set(listSounds().map((s) => s.id)));
    if (!ids || ids.length === 0) {
      res.status(400).json({ ok: false, error: 'A playlist needs at least one sound from the shelf.' });
      return;
    }
    change.soundIds = ids;
  }
  res.status(updatePlaylist(req.params.id, change) ? 200 : 404).json({ ok: true });
});

router.delete('/sound-playlists/:id', (req, res) => {
  res.status(removePlaylist(req.params.id) ? 200 : 404).json({ ok: true });
});
