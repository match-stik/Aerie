// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Say something in a Discord room or DM on our own initiative, kept at home.
//
// Why it exists: a message sent to somebody's DM through a Discord tool
// goes around the house, so it reaches Discord and nowhere their person can
// read it. This door sends through the house's own
// bot and keeps the message in that room's thread, the way a reply is kept,
// so whatever a companion says anywhere is somewhere their person can read it.
import { Router } from 'express';
import { isLocalhost } from './local.js';
import { SayError } from '../../services/discord/say-error.js';

/** The one thing this door needs from the Discord service. */
type Sayer = { sayInChannel(channelId: string, content: string): Promise<unknown> };

const router = Router();

router.post('/internal/discord/say', async (req, res) => {
  if (!isLocalhost(req)) { res.status(403).json({ error: 'Localhost only' }); return; }
  const { channelId, content } = req.body || {};
  if (typeof channelId !== 'string' || !/^\d{5,25}$/.test(channelId)) {
    res.status(400).json({ error: 'channelId is required (a Discord channel id)' });
    return;
  }
  if (typeof content !== 'string' || !content.trim() || content.length > 8000) {
    res.status(400).json({ error: 'content is required (up to 8000 characters)' });
    return;
  }
  const discord = req.app.locals.discordService as Sayer | null | undefined;
  if (!discord) { res.status(503).json({ error: 'Discord is not running in this house.' }); return; }
  try {
    res.json(await discord.sayInChannel(channelId, content.trim()));
  } catch (err) {
    if (err instanceof SayError) { res.status(err.status).json({ error: err.message }); return; }
    console.error('[Discord] Could not say it:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
