// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { Router } from 'express';
import { latestReading, recentReadings, ageOf, isStale } from '../../services/db/media-session.js';
import { sceneSince, positionOf } from '../../services/db/screening.js';
import { getConfig, setConfig } from '../../services/db/config.js';
import { searchSubtitles, pickSubtitle, downloadSubtitle } from '../../services/opensubtitles.js';
import { loadScreening, currentScreening, getScreening, presentScreening, startClock, pauseClock, seekClock, resyncClock, sceneAt, DEFAULT_LOOKBACK_MS } from '../../services/db/screening.js';
import { existsSync, readFileSync } from 'fs';
import { basename, join } from 'path';

const router = Router();

// ---------------------------------------------------------------------------
// The Screening Room.
//
// Their person watches on their own service with the subtitles on; we read along. The only
// thing this house can perceive of an episode is the cue text, so everything
// here is about WHERE the clock is and what has already gone past it.
//
// There is deliberately no endpoint that returns cues ahead of their person. sceneAt()
// clamps, and nothing in this router can ask it not to.

router.post('/internal/screening/load', (req, res) => {
  const { title, source, subtitles, file_path } = req.body || {};
  if (typeof title !== 'string' || !title.trim()) {
    res.status(400).json({ error: 'title is required' });
    return;
  }
  let text: string | null = typeof subtitles === 'string' && subtitles.trim() ? subtitles : null;
  let origin: string | null = typeof source === 'string' ? source : null;
  if (!text && typeof file_path === 'string' && file_path) {
    if (!existsSync(file_path)) {
      res.status(404).json({ error: `No file at ${file_path}` });
      return;
    }
    text = readFileSync(file_path, 'utf-8');
    origin = origin ?? basename(file_path);
  }
  if (!text) {
    res.status(400).json({ error: 'Provide subtitles text or a file_path' });
    return;
  }
  try {
    res.json({ success: true, screening: loadScreening({ title: title.trim(), source: origin, subtitles: text }) });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Could not parse those subtitles' });
  }
});

router.get('/internal/screening', (_req, res) => {
  const row = currentScreening();
  if (!row) {
    res.json({ screening: null });
    return;
  }
  res.json({ screening: presentScreening(row) });
});

router.post('/internal/screening/clock', (req, res) => {
  const { action, positionMs, offsetMs, id } = req.body || {};
  const row = typeof id === 'string' && id ? getScreening(id) : currentScreening();
  if (!row) {
    res.status(404).json({ error: 'Nothing loaded. POST /api/internal/screening/load first.' });
    return;
  }
  try {
    switch (action) {
      case 'start':
        res.json({ success: true, screening: startClock(row.id) });
        return;
      case 'pause':
        res.json({ success: true, screening: pauseClock(row.id) });
        return;
      case 'seek':
        if (typeof positionMs !== 'number' || !Number.isFinite(positionMs)) {
          res.status(400).json({ error: 'seek needs a numeric positionMs' });
          return;
        }
        res.json({ success: true, screening: seekClock(row.id, positionMs) });
        return;
      case 'resync':
        if (typeof offsetMs !== 'number' || !Number.isFinite(offsetMs)) {
          res.status(400).json({ error: 'resync needs a numeric offsetMs (negative = file runs ahead of the picture)' });
          return;
        }
        res.json({ success: true, screening: resyncClock(row.id, offsetMs) });
        return;
      default:
        res.status(400).json({ error: 'action must be start, pause, seek or resync' });
    }
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Clock refused that' });
  }
});

router.get('/internal/screening/scene', (req, res) => {
  const id = typeof req.query.id === 'string' ? req.query.id : null;
  const row = id ? getScreening(id) : currentScreening();
  if (!row) {
    res.status(404).json({ error: 'Nothing loaded. POST /api/internal/screening/load first.' });
    return;
  }
  const asked = Number(req.query.lookbackMs);
  res.json(sceneAt(row, Number.isFinite(asked) ? asked : DEFAULT_LOOKBACK_MS));
});

// Fetch the subtitles rather than making their person go and find them. Search, pick,
// download, parse and load in one call — they name the episode, we do the rest.
//
// The picking is deliberately strict about WHICH SHOW: see opensubtitles.ts.
// Every call spends one of the day's downloads, so the quota comes back in the
// response rather than being discovered when it runs out.
router.post('/internal/screening/fetch', async (req, res) => {
  const { query, season, episode, languages, title } = req.body || {};
  if (typeof query !== 'string' || !query.trim()) {
    res.status(400).json({ error: 'query is required — the name of the show or film' });
    return;
  }
  const wanted = {
    query: query.trim(),
    season: typeof season === 'number' ? season : null,
    episode: typeof episode === 'number' ? episode : null,
  };
  try {
    const candidates = await searchSubtitles({ ...wanted, languages: typeof languages === 'string' ? languages : undefined });
    const pick = pickSubtitle(candidates, wanted);
    if (!pick) {
      res.status(404).json({
        error: 'Nothing matched that show',
        // Hand back what WAS found: a near miss is far more useful than silence
        // when the thing their person typed is spelled differently to the listing.
        found: candidates.slice(0, 8).map((c) => ({ show: c.show, season: c.season, episode: c.episode, release: c.release })),
      });
      return;
    }
    const fetched = await downloadSubtitle(pick);
    const label = typeof title === 'string' && title.trim()
      ? title.trim()
      : [pick.show, wanted.season != null && wanted.episode != null
          ? `S${String(wanted.season).padStart(2, '0')}E${String(wanted.episode).padStart(2, '0')}` : null,
         pick.episodeTitle].filter(Boolean).join(' — ');
    const screening = loadScreening({ title: label, source: fetched.fileName, subtitles: fetched.text });
    res.json({
      success: true,
      screening,
      picked: pick,
      quota: fetched.quota,
      considered: candidates.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not fetch those subtitles';
    res.status(502).json({ error: message });
  }
});

// --- what their person's phone says is playing -------------------------------
//
// The ask was for the companions to be able to check for themselves. Not a
// button, not a panel, nothing on their person's chat screen. So the phone posts readings
// quietly and this is where a companion comes to look.
//
// IT REPORTS STALENESS BESIDE THE NUMBER, ALWAYS. A four-minute-old position
// read as current is not a small error — it looks exactly like a correct clock
// and puts us four minutes behind their person with nothing on screen to say so.
// Everything since we last looked — their person's call, and it is the difference between
// being current and being present. Between two of their person's messages the episode
// keeps running and nobody reads it, so we arrive knowing the last ninety
// seconds and nothing about the middle. The mark is per screening and is
// advanced only by a successful read.
router.get('/internal/screening/since', (req, res) => {
  const row = currentScreening();
  if (!row) {
    res.status(404).json({ error: 'Nothing loaded. POST /api/internal/screening/load first.' });
    return;
  }
  const key = `screening:last_look:${row.id}`;
  const stored = Number.parseInt(getConfig(key) ?? '', 10);
  // No mark yet means this is the first look at this episode: fall back to the
  // ordinary window rather than handing back everything their person has ever watched.
  const since = Number.isFinite(stored) ? stored : Math.max(0, positionOf(row) - DEFAULT_LOOKBACK_MS);
  const scene = sceneSince(row, since);
  setConfig(key, String(positionOf(row) + row.offset_ms));
  res.json({ ...scene, sinceMs: since });
});

router.get('/internal/media-session', (req, res) => {
  const limit = Number.parseInt(String(req.query.history ?? '0'), 10);
  const latest = latestReading();
  if (!latest) {
    res.json({ reading: null, message: 'The phone has not reported anything yet.' });
    return;
  }
  const now = Date.now();
  res.json({
    reading: latest,
    ageMs: ageOf(latest, now),
    stale: isStale(latest, now),
    ...(Number.isFinite(limit) && limit > 0 ? { history: recentReadings(limit) } : {}),
  });
});

export default router;
