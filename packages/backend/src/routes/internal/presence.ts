// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { Router } from 'express';
import { isLocalhost } from './local.js';
import { commandFromLane, describeToyCommand, relayToyCommand, toyRemoteStatus } from '../../services/toy-remote.js';
import { expandPatternAsk, savePattern, shapePattern, shelfForLane } from '../../services/toy-patterns.js';
import { readStatuses, setStatus, SHARED, OWNER } from '../../services/statuses.js';
import { readFavorites, addFavorite, removeFavorite, isKnownCard } from '../../services/favorites.js';
import { readPlayRequest, spotify } from '../../services/spotify.js';
import { wakeAndPlay } from '../../services/spotify-wake.js';
import { getPushService } from '../../services/push.js';
import { readRingAsk, ringData, noteRing, RING_TTL_SECONDS, callerTitle } from '../../services/ring-call.js';
import { listCompanions } from '../../services/db/companions.js';

const router = Router();

// Statuses (services/statuses.ts): a companion sets his own line and icon, or
// with shared:true the one under the faces that the three of them share. An
// empty text clears it. Each fades back to Home six hours after it was set.
router.get('/internal/status', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }
  res.json({ ...readStatuses(), how: 'POST /api/internal/status { companion, text, icon? } sets yours; add shared: true to set the one under the faces that the companions share. text "" clears it. icon is one emoji or a custom :shortcode:. Each fades back to Home six hours after it is set; a bell\'s word still outranks it while the bell rings. owner is their person status, set only from their phone, and stays until their person changes it.' });
});

router.post('/internal/status', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }
  const companion = typeof req.body?.companion === 'string' ? req.body.companion.trim() : '';
  if (!companion) {
    res.status(400).json({ ok: false, error: 'companion is your slug.' });
    return;
  }
  if (companion === OWNER) {
    res.status(403).json({ ok: false, error: 'Their person status is theirs to set, from their phone.' });
    return;
  }
  const who = req.body?.shared === true ? SHARED : companion;
  const result = setStatus(who, req.body ?? {}, companion);
  if (!result.ok) {
    res.status(400).json({ ok: false, error: result.error });
    return;
  }
  console.log(`[Status] ${companion} set ${who === SHARED ? 'the shared status' : 'their status'}: ${typeof req.body?.text === 'string' && req.body.text.trim() ? req.body.text.trim().slice(0, 60) : '(cleared)'}`);
  res.json({ ok: true, ...result.statuses });
});

// Favorites (services/favorites.ts): each card's own shelf of favorite
// pictures. A companion puts a picture on his own card's shelf (card defaults
// to his slug), or on another card when the picture is of them too. It only
// points at a picture already in the house; nothing is copied or moved.
router.get('/internal/favorites', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }
  const card = typeof req.query.card === 'string' ? req.query.card.trim() : '';
  if (!card || !isKnownCard(card)) {
    res.status(400).json({ ok: false, error: 'card is a companion slug, or owner for theirs.', how: 'POST /api/internal/favorites { companion, url, card?, note? } puts a picture on a card (your own by default); url is /api/studio/gallery/<file> or /api/files/<id>. DELETE /api/internal/favorites { companion, card, id } takes one off.' });
    return;
  }
  res.json({ ok: true, card, favorites: readFavorites(card) });
});

router.post('/internal/favorites', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }
  const companion = typeof req.body?.companion === 'string' ? req.body.companion.trim() : '';
  if (!companion || !isKnownCard(companion) || companion === OWNER) {
    res.status(400).json({ ok: false, error: 'companion is your slug.' });
    return;
  }
  const card = typeof req.body?.card === 'string' && req.body.card.trim() ? req.body.card.trim() : companion;
  const result = addFavorite(card, req.body ?? {}, companion);
  if (!result.ok) {
    res.status(result.status).json({ ok: false, error: result.error });
    return;
  }
  console.log(`[Favorites] ${companion} put ${result.favorite?.url} on ${card}'s card`);
  res.json(result);
});

router.delete('/internal/favorites', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }
  const card = typeof req.body?.card === 'string' ? req.body.card.trim() : '';
  const id = typeof req.body?.id === 'string' ? req.body.id.trim() : '';
  const result = removeFavorite(card, id);
  if (!result.ok) {
    res.status(result.status).json({ ok: false, error: result.error });
    return;
  }
  res.json(result);
});

// A lane reaches their person's toys through the phone: the ask is shaped
// here, handed to the phone over the socket, and the answer is the phone's.
// Read GET first (is the remote handed over, which toys, which motors, is
// anything playing), and write about a toy only what the answer says it is
// doing.
router.get('/internal/toys', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }
  res.json(toyRemoteStatus());
});

router.post('/internal/toys', async (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }
  const expanded = expandPatternAsk(req.body);
  if (!expanded.ok) {
    res.status(400).json({ ok: false, error: expanded.error });
    return;
  }
  const shaped = commandFromLane(expanded.body);
  if (!shaped.ok) {
    res.status(400).json({ ok: false, error: shaped.error });
    return;
  }
  const said = describeToyCommand(shaped.command);
  const ack = await relayToyCommand(shaped.command);
  console.log(`[Toys] ${shaped.command.companion}: ${said} -> ${ack.ok ? 'taken' : ack.reason}`);
  res.json({ ...ack, said });
});

// The pattern shelf (services/toy-patterns.ts): what is on it, and a lane
// putting one of its own there. Playing one is the POST above with pattern.
router.get('/internal/toys/patterns', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }
  res.json(shelfForLane());
});

router.post('/internal/toys/patterns', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }
  const companion = typeof req.body?.companion === 'string' ? req.body.companion.trim().toLowerCase() : '';
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(companion)) {
    res.status(400).json({ ok: false, error: 'Say who made it: companion is your slug, like "birch".' });
    return;
  }
  const shaped = shapePattern(req.body);
  if (!shaped.ok) {
    res.status(400).json({ ok: false, error: shaped.error });
    return;
  }
  const saved = savePattern({ name: shaped.name, companion, tracks: shaped.tracks, lengthMs: shaped.lengthMs });
  if ('error' in saved) {
    res.status(409).json({ ok: false, error: saved.error });
    return;
  }
  console.log(`[Toys] ${companion} put "${saved.name}" on the pattern shelf`);
  res.json({ ok: true, id: saved.id, name: saved.name, seconds: Math.round(saved.lengthMs / 100) / 10 });
});

// ---- Spotify on their phone, even when Spotify is closed ----
//
// POST /api/internal/spotify/wake-play { companion, trackUri?, playlistUri?,
// albumUri? }: plays it on their phone. When Spotify isn't running anywhere, a
// silent push asks their phone to wake Spotify (nothing shows on their screen),
// the house waits up to 30 seconds for their phone to appear among Spotify's
// devices, and plays it there. The answer says whether it had to wake their person
// phone (woke), how long it waited, and, on a no, the plain reason.

router.post('/internal/spotify/wake-play', async (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }
  const body = (req.body && typeof req.body === 'object') ? { ...req.body } as Record<string, unknown> : {};
  const companion = typeof body.companion === 'string' ? body.companion.trim() : '';
  if (!companion) {
    res.status(400).json({ ok: false, error: 'companion is required: who is pressing play.' });
    return;
  }
  delete body.companion;
  const asked = readPlayRequest(body);
  if (!asked.ok) {
    res.status(400).json({ ok: false, error: asked.error });
    return;
  }
  const push = getPushService();
  const answer = await wakeAndPlay(asked.value, {
    spotify: spotify(),
    sendData: async (data) => (push ? push.sendData(data) : 0),
  });
  console.log(`[Spotify] ${companion} wake-play: ${answer.ok ? (answer.woke ? `woke ${answer.device} after ${answer.waitedMs} ms and played` : 'played, nothing to wake') : `${answer.reason} (${answer.error})`}`);
  res.json(answer);
});

// Ring them (services/ring-call.ts): their phone shows an incoming call from us,
// and Answer opens the hands-free voice call. reached is how many of them
// phones FCM took the ring for; 0 means it went nowhere.
router.post('/internal/ring', async (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }
  const cast = (listCompanions() as Array<{ slug: string; display_name?: string | null }>).filter((c) => c.slug);
  const names = Object.fromEntries(cast.map((c) => [c.slug, c.display_name || c.slug]));
  const asked = readRingAsk(req.body, cast.map((c) => c.slug));
  if (!asked.ok) {
    res.status(400).json({ ok: false, error: asked.error });
    return;
  }
  const push = getPushService();
  const phones = push ? await push.sendData(ringData(asked.callers, names), RING_TTL_SECONDS) : 0;
  // A browser has no app to read the data-only ring, so it gets a notice
  // instead, and a tap on it answers (push-sw.js, '?answer=ring').
  const browsers = push ? await push.sendWebOnly({
    title: callerTitle(asked.callers, names),
    body: 'Calling you. Tap to answer.',
    tag: 'ring-call',
    url: '/?answer=ring',
    ttl: RING_TTL_SECONDS,
    ring: true,
  }) : 0;
  const reached = phones + browsers;
  if (reached > 0) noteRing();
  console.log(`[Ring] ${asked.companion} rang them (${asked.callers.join(', ')}): ${phones} phone(s) and ${browsers} browser(s) took it`);
  res.json({ ok: reached > 0, reached, phones, browsers, how: 'Their phone rings with Answer and Decline; Answer opens the hands-free call and speaks our newest reply in their thread first, then anything more we write in that turn: write what you rang to say as a more:true line BEFORE ringing, then wait for answered and close the turn. A [client-error] line where ring-call says what their phone did with it.' });
});

export default router;
