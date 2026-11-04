// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { Router } from 'express';
import type { VoiceService } from '../../services/voice.js';

const router = Router();

// Voice diagnostics — what's actually loaded into the VoiceService.
// Useful when multi-voice splitting isn't routing the way you'd expect:
// shows the voice IDs mapped per slug, the companions the splitter can see,
// and whether ElevenLabs is reachable at all.
router.get('/voice/status', (req, res) => {
  const voiceService = req.app.locals.voiceService as VoiceService | undefined;
  if (!voiceService) {
    res.status(500).json({ error: 'VoiceService not initialized' });
    return;
  }
  res.json(voiceService.describe());
});

// ElevenLabs credit meter — live subscription usage for the phone's
// Integrations card. The key needs the user_read permission.
router.get('/voice/usage', async (req, res) => {
  const voiceService = req.app.locals.voiceService as VoiceService | undefined;
  if (!voiceService) {
    res.status(500).json({ error: 'VoiceService not initialized' });
    return;
  }
  try {
    res.json(await voiceService.getElevenLabsUsage());
  } catch (error) {
    res.status(502).json({
      error: error instanceof Error ? error.message : 'ElevenLabs usage unavailable',
    });
  }
});

// Claude subscription usage — the same OAuth endpoint the CLI polls for
// its own /usage screen, read with the token already on disk. Cached 60s.
router.get('/usage/claude', async (req, res) => {
  try {
    const { getClaudeUsage } = await import('../../services/subscription-usage.js');
    res.json(await getClaudeUsage());
  } catch (error) {
    res.status(502).json({
      error: error instanceof Error ? error.message : 'Claude usage unavailable',
    });
  }
});

// Codex rate limits — read from the freshest token_count stamp the daemon
// writes into its own session transcripts. No API call, refreshes every sweep.
router.get('/usage/codex', async (req, res) => {
  try {
    const { getCodexUsage } = await import('../../services/subscription-usage.js');
    res.json(await getCodexUsage());
  } catch (error) {
    res.status(502).json({
      error: error instanceof Error ? error.message : 'Codex usage unavailable',
    });
  }
});

// Antigravity model quota. Read by asking the CLI's own /usage
// slash command headlessly; it costs no model turn and answers in under a
// second. Same shape as the Codex reader: ask the tool what it already knows
// rather than asking the provider ourselves.
router.get('/usage/antigravity', async (req, res) => {
  try {
    const { getAntigravityUsage } = await import('../../services/antigravity-usage.js');
    res.json(await getAntigravityUsage());
  } catch (error) {
    res.status(502).json({
      error: error instanceof Error ? error.message : 'Antigravity usage unavailable',
    });
  }
});

// Wipe cached TTS audio. With no body, clears every cached file —
// useful when the splitter changed and you want existing messages
// re-generated under the new rules. With { messageId }, clears one.
router.post('/voice/clear-tts-cache', async (req, res) => {
  const { clearMessageTts } = await import('../../services/db.js');
  const messageId = typeof req.body?.messageId === 'string' ? req.body.messageId : undefined;
  const removed = clearMessageTts(messageId);
  res.json({ success: true, removed });
});

// Force-reload voice secrets from the DB. The /api/secrets PUT route calls
// refresh() automatically; this is here for the case where a companion was
// added via /api/companions after boot — the splitter caches nothing, but
// orphan voice IDs whose slug only just got registered won't be picked up
// without a re-read.
router.post('/voice/refresh', (req, res) => {
  const voiceService = req.app.locals.voiceService as VoiceService | undefined;
  if (!voiceService) {
    res.status(500).json({ error: 'VoiceService not initialized' });
    return;
  }
  voiceService.refresh();
  res.json({ success: true, ...voiceService.describe() });
});

export default router;
