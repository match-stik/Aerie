// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Cross-browser app settings, served at /api/app-settings. NOT /api/settings
// — that path belongs to api.ts's agent-config KV routes, which are mounted
// first and shadowed this router's routes completely for two months (the
// phone's sync GET got {config} instead of {settings}, read it as 'server
// empty', and its seeding PUT bounced off the KV validator with a 400 the
// client swallowed). Single JSON blob stored under
// `config.app_settings` so theme, contacts, fonts, wallpapers etc.
// follow the user across devices the same way BYOK secrets do.
//
// One blob keyed per install (single-user model). 25 MB cap on the
// PUT — wallpaper slideshows can run a few MB of base64 per image and
// we don't want to clamp them too aggressively. If size becomes a real
// problem, wallpapers can be factored out to /api/files refs later.

import { Router, json } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { getConfig, setConfig, deleteConfig } from '../services/db.js';

const APP_SETTINGS_KEY = 'app_settings';

const router = Router();
router.use(authMiddleware);

// Per-route body parser — the global limit is 10 MB to stay defensive
// against accidental DoS, but the settings blob can legitimately carry
// wallpaper slideshows that push 15-20 MB.
const settingsJson = json({ limit: '25mb' });

router.get('/app-settings', (_req, res) => {
  const raw = getConfig(APP_SETTINGS_KEY);
  if (!raw) {
    res.json({ settings: null });
    return;
  }
  try {
    res.json({ settings: JSON.parse(raw) });
  } catch (err) {
    console.error('[Settings] Stored blob was not valid JSON:', err);
    res.json({ settings: null });
  }
});

router.put('/app-settings', settingsJson, (req, res) => {
  const value = req.body?.settings;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    res.status(400).json({ error: 'settings must be a JSON object' });
    return;
  }
  try {
    setConfig(APP_SETTINGS_KEY, JSON.stringify(value));
    res.json({ ok: true });
  } catch (err) {
    console.error('[Settings] Failed to persist:', err);
    res.status(500).json({ error: 'Failed to persist settings' });
  }
});

router.delete('/app-settings', (_req, res) => {
  deleteConfig(APP_SETTINGS_KEY);
  res.json({ ok: true });
});

export default router;
