// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The car's media browser reads its shelves here (services/car-library.ts).
// Behind the same sign-in as the rest of /api; the APK sends its cookie.
import { Router } from 'express';
import { carLibrary } from '../../services/car-library.js';
import { getFile } from '../../services/files.js';
import { readAloudFor, ReadAloudError } from './message-tts.js';
import type { VoiceService } from '../../services/voice.js';
import { getDb } from '../../services/db/state.js';
import { takeRing, pickGreeting, type GreetingRow } from '../../services/ring-call.js';

const router = Router();

router.get('/car/library', (_req, res) => {
  try {
    res.json(carLibrary());
  } catch (err) {
    console.error('[Car] Could not list the library:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// One reply from the Latest shelf, as audio. The cached read-aloud if they have
// heard it before, otherwise rendered now (paid, once) and cached for the
// bubble's speaker too. The file is sent straight back rather than redirected,
// so the car's player needs only the one request with its cookie.
router.get('/car/play/:id', async (req, res) => {
  try {
    const voiceService = req.app.locals.voiceService as VoiceService | undefined;
    const made = await readAloudFor(req.params.id, voiceService);
    const file = getFile(made.fileId);
    if (!file) {
      res.status(404).json({ error: 'The audio file is missing' });
      return;
    }
    res.type(file.mimeType || 'audio/mpeg');
    res.sendFile(file.path);
  } catch (err) {
    if (err instanceof ReadAloudError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error('[Car] Could not play a reply:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// A call opening asks whether it answers one of our rings
// (services/ring-call.ts). If it does, the phone speaks the message named
// here before it starts listening; otherwise it listens straight away.
router.get('/ring/greeting', (req, res) => {
  try {
    const threadId = typeof req.query.threadId === 'string' ? req.query.threadId : '';
    if (!threadId || !takeRing()) {
      res.json({ greeting: null });
      return;
    }
    const rows = getDb().prepare(`
      SELECT id, role, sequence, content, content_type FROM messages
      WHERE thread_id = ? AND deleted_at IS NULL AND role IN ('user', 'companion')
      ORDER BY sequence DESC LIMIT 20
    `).all(threadId) as GreetingRow[];
    const greeting = pickGreeting(rows);
    console.log(`[Ring] call opened from a ring; greeting ${greeting ? greeting.messageId : 'none'}`);
    res.json({ greeting });
  } catch (err) {
    console.error('[Ring] Could not pick a greeting:', err);
    res.json({ greeting: null });
  }
});

export default router;
